import { Router as expressRouter } from "express";
import { logger } from "lu-logger";
import * as uuid from "uuid";

import buildContext from "./context.js";
import { sendToDlx } from "./dlx.js";
import { errorHandler } from "./error-handler.js";
import jobStorage from "./job-storage/index.js";
import { router as middlewareRouter } from "./middleware/index.js";
import { publishTask, publishTasksBulk } from "./publish-task.js";
import resend from "./resend.js";
import { appendData, buildNextKeyMapper, buildUrl, keyToUrl, sequenceIterator } from "./utils/sequences.js";
import validate from "./validator.js";

// Ugly hack to make lu-logger accept the same interface as pino.
// When all workers have been migrated, we'll rewrite them to use lu-logger
// directly, and then we can remove this
logger.warn = logger.warning;

export default function cloudTasksRouter(recipes = [], triggers = {}) {
  const router = expressRouter();
  router.use(middlewareRouter);

  buildCloudTaskTriggerRoutes(router, triggers);

  const nextKeyMapper = buildNextKeyMapper(recipes);
  recipes.forEach((seq) => buildCloudTaskSequenceRoutes(router, seq, nextKeyMapper));
  router.post("/resend", resend);
  router.use(errorHandler);
  return router;
}

function buildCloudTaskTriggerRoutes(router, triggers) {
  Object.entries(triggers).forEach(([ key, func ]) => {
    const triggerKey = key.replace("trigger.", "");
    router.post(`/trigger/${triggerKey}`, messageHandler(func));
  });
}

function buildCloudTaskSequenceRoutes(router, { namespace, name, sequence, unrecoverable, schema }, nextKeyMapper) {
  for (const { key, func } of sequenceIterator(sequence)) {
    router.post(buildUrl(namespace, name, key), messageHandler(func, nextKeyMapper(`${namespace}.${name}.${key}`), schema));
  }
  // Allow to start a sequence/sub-sequence by posting to the sequence name
  router.post(`/${namespace}/${name}`, startSequence(sequenceIterator(sequence).next().value));

  router.post(buildUrl(namespace, name, "processed"), processedHandler);
  router.post(buildUrl(namespace, name, ":taskName/unrecoverable"), unrecoverableHandler(unrecoverable?.[0]?.["*"]));
  router.post(buildUrl(namespace, name, ":taskName/unrecoverable/processed"), processedHandler);
}

function startSequence({ key: firstKeyInSequence, queue }) {
  return async (req, res) => {
    const { correlationId, parentCorrelationId, grandParentCorrelationId, siblingCount, parentSiblingCount, runId } =
      req.attributes;
    await publishTask(
      `${req.attributes.relativeUrl}/${firstKeyInSequence.replace(/^\./, "")}`,
      appendData(req.body, []), // Ensure we have a data element
      { correlationId, parentCorrelationId, grandParentCorrelationId, siblingCount, parentSiblingCount, runId },
      queue
    );
    res.status(201).send({ correlationId, runId });
  };
}

function messageHandler(func, { nextKey, queue } = {}, schema) {
  return async (req, res) => {
    const body = schema ? validate(req.body, schema) : req.body;

    const {
      key,
      correlationId,
      parentCorrelationId,
      grandParentCorrelationId,
      siblingCount,
      parentSiblingCount,
      runId,
    } = req.attributes;
    const context = { ...buildContext(correlationId, key), logger }; // Overwrite the logger with the one from lu-logger;

    const result = await func(body, context);

    const nextBody = appendData(body, result);

    if (result?.type === "trigger") {
      const triggerResponse = await handleTriggerResult(result, nextBody, { nextKey, queue }, req.attributes);
      if (triggerResponse) return res.status(triggerResponse.status).send(triggerResponse.message);
    }

    if (nextKey) {
      await publishTask(
        keyToUrl(nextKey),
        nextBody,
        { correlationId, parentCorrelationId, grandParentCorrelationId, siblingCount, parentSiblingCount, runId },
        queue
      );
    } else {
      logger.info("No more steps in this sequence");
    }
    res.status(201).send({ correlationId, runId });
  };
}

async function handleTriggerResult(
  result,
  body,
  { nextKey, queue },
  { key, correlationId, parentCorrelationId, grandParentCorrelationId, siblingCount, parentSiblingCount, runId }
) {
  const errorMessage = checkForTriggerError(result);
  if (errorMessage) {
    logger.error(errorMessage);
    return { message: errorMessage, status: 400 };
  }

  result.key = result.key.replace("trigger.", "").replace(/^\./, "");
  if (result.key.startsWith("sub-sequence")) {
    if (result.messages.length > 0) {
      if (grandParentCorrelationId) {
        const tooDeepMessage = `It is only possible to nest one level of sub-sequences, you're trying to trigger ${
          result.key
        } from ${key} which in turn was triggered from ${parentCorrelationId
          .split(":")
          .shift()} - either rethink what you're trying to do, or implement great-grandchilden in b0rker...`;
        logger.error(tooDeepMessage);
        return { message: tooDeepMessage, status: 400 };
      }
      // If we start sub-sequences, spawn these, and then exit. The main sequence will be resumed
      // when the last child completes
      await startSubSequences(
        result,
        `${key}:${correlationId}`,
        parentCorrelationId,
        siblingCount,
        { nextKey, queue, runId },
        body
      );
      return { message: "Sub-sequences started", status: 200 };
    }
  } else if (result.key.startsWith("sequence")) {
    // If we trigger another main sequence, we fire-and-forget and continue with the main sequence immediately
    await triggerOtherSequences(body, result, {
      correlationId,
      parentCorrelationId,
      grandParentCorrelationId,
      siblingCount,
      parentSiblingCount,
    });
  } else {
    logger.error(`Invalid trigger key ${result.key} returned from handler`);
    return { message: `Invalid trigger key ${result.key}`, status: 400 };
  }
}

function checkForTriggerError(result) {
  if (!result.key) {
    return "Invalid result: missing trigger key";
  }
  if (
    (result.key.startsWith("sequence") || result.key.includes("sub-sequence")) &&
    !(result.messages && Array.isArray(result.messages))
  ) {
    return `Invalid result: messages need to be an array got: ${JSON.stringify(result.messages)}`;
  }
  if (result.messages && !Array.isArray(result.messages)) {
    return `Invalid result: invalid messages ${JSON.stringify(result.messages)} for handler that returns a trigger`;
  }
}

async function startSubSequences(
  result,
  parentCorrelationId,
  grandParentCorrelationId,
  parentSiblingCount,
  { nextKey, queue, runId },
  message
) {
  const messages = result.messages.map((o) => ({
    body: o,
    headers: { grandParentCorrelationId, parentCorrelationId, correlationId: uuid.v4(), parentSiblingCount },
  }));
  logger.info(`Starting ${result.messages.length} subsequences`);
  await jobStorage.storeParent(parentCorrelationId, messages, message, { nextKey, queue, runId });
  await publishTasksBulk(keyToUrl(result.key), messages);
}

async function triggerOtherSequences(
  originalMessage,
  result,
  { grandParentCorrelationId, parentCorrelationId, correlationId, siblingCount, parentSiblingCount }
) {
  const messages = (result.messages || [ originalMessage ]).map((m, idx) => ({
    body: { ...m, data: [ ...(m.data ?? []) ], messages: undefined },
    headers: {
      grandParentCorrelationId,
      parentCorrelationId,
      correlationId: `${correlationId}:${idx}`,
      siblingCount,
      parentSiblingCount,
    },
  }));
  await publishTasksBulk(keyToUrl(result.key), messages);
}

function unrecoverableHandler(unrecoverableFunc) {
  return async (req, res) => {
    if (!unrecoverableFunc) {
      await sendToDlx(req, "No unrecoverable handler found for unrecoverable message");
      return res.status(200).send();
    }

    const {
      key,
      correlationId,
      parentCorrelationId,
      grandParentCorrelationId,
      siblingCount,
      parentSiblingCount,
      runId,
    } = req.attributes;
    const context = { ...buildContext(correlationId, key), logger }; // Overwrite the logger with the one from lu-logger;

    const result = await unrecoverableFunc(req.body, context);

    await publishTask(`${req.attributes.relativeUrl}/processed`, appendData(req.body, result), {
      correlationId,
      parentCorrelationId,
      grandParentCorrelationId,
      siblingCount,
      parentSiblingCount,
      runId,
    });
    return res.status(200).send();
  };
}

async function processedHandler(req, res) {
  const { key, correlationId, parentCorrelationId, grandParentCorrelationId, siblingCount, parentSiblingCount, runId } =
    req.attributes;

  logger.info(
    `The sequence is finished: ${JSON.stringify(
      key,
      correlationId,
      parentCorrelationId,
      grandParentCorrelationId,
      siblingCount,
      parentSiblingCount,
      runId
    )}`
  );
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
    const mainSequenceRunId = parentData.nextKey.runId;
    await publishTask(
      keyToUrl(parentData.nextKey.nextKey),
      newBody,
      {
        correlationId: originalCorrelationId,
        parentCorrelationId: grandParentCorrelationId,
        siblingCount: parentSiblingCount,
        ...(mainSequenceRunId && { runId: mainSequenceRunId }),
      },
      parentData.nextKey?.queue
    );
  }
  return res.status(200).send();
}
