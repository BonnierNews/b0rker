import { Router as expressRouter } from "express";
import { logger } from "lu-logger";
import * as uuid from "uuid";

import { router as middlewareRouter } from "./middleware/index.js";
import { errorHandler } from "./error-handler.js";
import { publishTask, publishTasksBulk } from "./publish-task.js";
import { appendData, buildNextKeyMapper, buildUrl, keyToUrl, sequenceIterator } from "./utils.js";
import buildContext from "../context.js";
import jobStorage from "../job-storage/index.js";

export default function cloudTasksRouter(recipes) {
  const router = expressRouter();
  router.use(middlewareRouter);

  const nextKeyMapper = buildNextKeyMapper(recipes);
  recipes.forEach((seq) => buildCloudTaskSequenceRoutes(router, seq, nextKeyMapper));
  router.use(errorHandler);
  return router;
}

function buildCloudTaskSequenceRoutes(router, { namespace, name, sequence, unrecoverable }, nextKeyMapper) {
  for (const [ key, func ] of sequenceIterator(sequence)) {
    router.post(buildUrl(namespace, name, key), messageHandler(func, nextKeyMapper(`${namespace}.${name}.${key}`)));
  }
  // Allow to start a sequence/sub-sequence by posting to the sequence name
  router.post(`/${namespace}/${name}`, trigger(sequenceIterator(sequence).next().value[0]));

  router.post(buildUrl(namespace, name, ":taskName/unrecoverable"), unrecoverableHandler(unrecoverable?.[0]?.["*"]));

  router.post(buildUrl(namespace, name, "processed"), processedHandler);
}

function messageHandler(func, nextKey) {
  return async (req, res) => {
    const { key, correlationId, parentCorrelationId, siblingCount } = req.attributes;
    const context = { ...buildContext(correlationId, key), logger }; // Overwrite the logger with the one from lu-logger;

    const result = await func(req.body, context);

    const nextBody = appendData(req.body, result);

    if (result.type === "trigger") {
      if (result.key.startsWith("sub-sequence")) {
        if (!result.messages?.length) {
          throw new Error("Got sub-sequence trigger but no messages");
        }
        // If we start sub-sequences, spawn these, and then exit. The main sequence will be resumed
        // when the last child completes
        await startSubSequences(result, `${key}:${correlationId}`, nextKey, nextBody);
        return res.status(200).send();
      } else if (result.key.startsWith("sequence")) {
        // If we trigger another main sequence, we fire-and-forget and continue with the main sequence immediately
        await triggerOtherSequences(result, { correlationId, parentCorrelationId, siblingCount });
      } else {
        logger.error(`Invalid trigger key ${result.key} returned from handler`);
        return res.status(400).send();
      }
    }

    if (nextKey) {
      await publishTask(keyToUrl(nextKey), nextBody, { correlationId, parentCorrelationId, siblingCount });
    } else {
      logger.info("No more steps in this sequence");
    }
    res.status(200).send();
  };
}

function trigger(firstKeyInSequence) {
  return async (req, res) => {
    const { correlationId, key } = req.attributes;
    await publishTask(keyToUrl(`${key}.${firstKeyInSequence}`), req.body, { correlationId });
    res.status(201).send();
  };
}

async function startSubSequences(result, parentCorrelationId, nextKey, message) {
  const messages = result.messages.map((o) => ({
    body: o,
    headers: { parentCorrelationId, correlationId: uuid.v4(), siblingCount: result.messages.length },
  }));
  logger.info(`Starting ${result.messages.length} subsequences`);
  await jobStorage.storeParent(parentCorrelationId, messages, message, nextKey);
  await publishTasksBulk(keyToUrl(result.key), messages);
}

// TODO Do we really need this?
async function triggerOtherSequences(result, { parentCorrelationId, correlationId, siblingCount }) {
  const messages = result.messages.map((m) => ({
    body: { ...m, data: [ ...(m.data ?? []) ], messages: undefined },
    headers: { parentCorrelationId, correlationId, siblingCount },
  }));
  await publishTasksBulk(keyToUrl(result.key), messages);
}

function unrecoverableHandler(unrecoverableFunc) {
  return async (req, res) => {
    if (!unrecoverableFunc) return res.status(200).send();

    const { key, correlationId, parentCorrelationId, siblingCount } = req.attributes;
    const context = { ...buildContext(correlationId, key), logger }; // Overwrite the logger with the one from lu-logger;

    const result = await unrecoverableHandler(req.body, context);

    const newBody = appendData(req.body, result);
    await publishTask(`${req.key}/processed`, newBody, { correlationId, parentCorrelationId, siblingCount });
    return res.status(200).send();
  };
}

async function processedHandler(req, res) {
  const { key, correlationId, parentCorrelationId, siblingCount } = req.attributes;

  logger.info(`The sequence is finished: ${JSON.stringify(key, correlationId, parentCorrelationId, siblingCount)}`);
  const [ sequence ] = key.split(".");

  if (sequence !== "sub-sequence") return res.status(200).send();

  logger.info("sub-sequence triggered from parent is finished, calling job storage to complete child");
  await jobStorage.completedChild({ parentCorrelationId, correlationId, key });

  const { isLast, parentData, completedJobCount } = await jobStorage.parentIsComplete({
    parentCorrelationId,
    key,
    siblingCount,
  });
  if (isLast) {
    const removedParent = await jobStorage.removeParent(parentCorrelationId);
    if (!removedParent) {
      logger.warning(
        `sub-sequence ${key} finished but parent ${parentCorrelationId} is already removed, probably due to ` +
          "multiple sub-sequences finishing at the same time. Main sequence continuation should already have " +
          "been triggered, exiting."
      );
      return res.status(200).send();
    }
    const originalCorrelationId = parentCorrelationId.split(":").slice(1).join(":");
    const newBody = appendData(parentData.message, { type: key, id: completedJobCount });
    await publishTask(keyToUrl(parentData.nextKey), newBody, { correlationId: originalCorrelationId });
  }
  return res.status(200).send();
}
