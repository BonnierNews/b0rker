import config from "exp-config";
import { v4 } from "uuid";

import publishMessage, { rejectMessage, publishMessagesBulk } from "./publish-message.js";
import resumeMessage from "./resume-message.js";
import buildContext from "./context.js";
import jobStorage from "./job-storage/index.js";
import metrics from "./metrics.js";

const maxResumeCount = config.maxResumeCount || 10;

async function runTrigger(fn, message, context) {
  if (!fn) return {};
  try {
    if (!(fn && typeof fn === "function")) {
      throw new Error(`Got trigger message for an unknown trigger handler, ${context.key}`);
    }

    const result = await fn(message, context);

    if (!isValidResult(result, context.logger)) {
      throw new Error(
        `Got invalid result from trigger handler on key: ${context.key}, result: ${JSON.stringify(result)}`
      );
    }

    return result;
  } catch (error) {
    return { error };
  }
}

async function handleTrigger(res, messageData, recipeMap, context, correlationId) {
  const { logger } = context;
  const {
    messageId,
    message,
    attributes: { key, parentCorrelationId, siblingCount },
  } = messageData;

  const triggerHandler = recipeMap.triggerHandler(key);
  const triggerResult = await runTrigger(triggerHandler, message, context);
  if (triggerHandler && !triggerResult) {
    logger.info(`Found nothing to trigger for message ${messageId}`);
    res.status(200).send();
    return;
  }
  const { key: triggerKey, messages, error } = triggerResult;
  if (error) {
    logger.error(
      `Got error running trigger for message with correlationId: ${correlationId}. Error: ${error}. Message: ${JSON.stringify(
        message
      )}`
    );
    res.status(400).send();
    return;
  }

  const [ , namespace, name ] = triggerKey?.split(".") || key.split(".");
  const firstStep = recipeMap.first(namespace, name);
  if (!firstStep) {
    logger.error(`Got trigger message for an unknown sequence, ${messageId}`);
    res.status(400).send();
    return;
  }

  if (Array.isArray(messages)) {
    for (const triggerMessage of messages) {
      await publishMessage(formatMessage(triggerMessage), {
        key: firstStep,
        correlationId,
        parentCorrelationId,
        siblingCount,
      });
    }
  } else {
    await publishMessage(formatMessage(message), {
      key: firstStep,
      correlationId,
      parentCorrelationId,
      siblingCount,
    });
  }

  res.status(200).send();
  return;
}

async function handleUnrecoverable(res, messageData, recipeMap, context, correlationId) {
  const {
    message,
    attributes: { key, parentCorrelationId, siblingCount },
  } = messageData;
  const prevKey = key.split(".").slice(0, -1).join(".");
  const unrecoverableHandler = recipeMap.unrecoverableHandler(prevKey);
  if (typeof unrecoverableHandler !== "function") {
    res.status(400).send();
    return;
  }

  try {
    const result = await unrecoverableHandler(message, context);
    const data = appendData(message.data, result);
    metrics.unrecoverableMessages.inc();
    await publishMessage(
      { ...message, data },
      { key: `${key}.processed`, correlationId, parentCorrelationId, siblingCount }
    );
  } catch (err) {
    res.status(500).send();
    return;
  }

  res.status(200).send();
  return;
}

async function handleProcessed(res, messageData, recipeMap, context, correlationId) {
  const { logger } = context;
  const {
    messageId,
    attributes: { key, parentCorrelationId, siblingCount },
  } = messageData;
  // Last message of each sequence has a *.processed key
  logger.info(`The sequence is finished ${messageId}`);
  const [ sequence ] = key.split(".");

  // Handle if the finished sequence is a sub-sequence that was triggered by another sequence
  if (sequence === "sub-sequence" && parentCorrelationId) {
    try {
      // Firestore transactions require all reads to be executed before all writes, so we write as one transaction
      logger.info(`sub-sequence triggered from parent is finished, calling job storage to complete child ${messageId}`);
      await jobStorage.completedChild({ parentCorrelationId, correlationId, key });
      // and then read as another, once that is done (note that parentData is unusable until isLast === true)
      const { isLast, parentData, completedJobCount } = await jobStorage.parentIsComplete({
        parentCorrelationId,
        key,
        siblingCount,
      });
      if (isLast) {
        await jobStorage.removeParent(parentCorrelationId);
        await publishMessage(
          { ...parentData.message, data: [ ...parentData.message.data, { type: key, id: completedJobCount } ] },
          { key: parentData.nextKey, correlationId, parentCorrelationId }
        );
      }
    } catch (error) {
      // if we get here then we're in an unknown state - the child has completed, but we haven't recorded that
      logger.error(
        `sub-sequence triggered from parent is finished but calling job storage to complete child failed: ${error}`
      );
      res.status(502).send();
      return;
    }
  }
  metrics.processedSequences.inc();

  res.status(200).send();
  return;
}

async function handleResultResume(res, messageData, result, context, correlationId) {
  const { logger } = context;
  const {
    message,
    attributes: { key, resumedCount, parentCorrelationId, siblingCount },
  } = messageData;
  if (Number(resumedCount) >= maxResumeCount) {
    logger.error(`Message delayed for max amount ${maxResumeCount} of times`);
    await rejectMessage(
      { ...message, error: `To many resume retries. Retries: ${resumedCount}` },
      { key, correlationId, parentCorrelationId, siblingCount }
    );
    res.status(200).send();
    return;
  }
  if (!isValidDelay(result.delayMs)) {
    logger.error(`Invalid delayMs ${result.delayMs} returned from handler`);
    res.status(400).send();
    return;
  }
  await resumeMessage(key, message, Number(resumedCount), result.delayMs, logger);
  res.status(200).send();
  return;
}

async function handleMessage(res, messageData, recipeMap, context, correlationId) {
  const { logger } = context;
  const {
    message,
    messageId,
    deliveryAttempt,
    attributes: { key, parentCorrelationId, siblingCount },
  } = messageData;
  // Resolve and invoke the handler for this step
  const handler = recipeMap.handler(key);
  try {
    const result = await handler(message, context);

    if (!isValidResult(result, logger)) {
      logger.error(`Got invalid result from handler on key: ${key}, result: ${JSON.stringify(result)}`);
      res.status(400).send();
      return;
    }

    const data = appendData(message.data, result, key);

    switch (result?.type) {
      // Handle resume result returned from handler
      case "resume":
        await handleResultResume(res, messageData, result, context, correlationId);
        return;
      // Handle trigger result returned from handler
      case "trigger":
        if (result.key.startsWith("sub-sequence")) {
          if (!result.messages?.length) break; // skip to next step if no messages

          await startChildProcesses(result, `${key}:${correlationId}`, recipeMap.next(key), {
            ...message,
            data,
          });
          res.status(200).send();
          return;
        } else if (result.key.startsWith("sequence")) {
          const triggerKey = recipeMap.first(...result.key.split("."));
          if (!triggerKey) {
            logger.error(`Got trigger message for an unknown sequence, ${result.key}`);
            res.status(400).send();
            return;
          }
          await publishMessagesBulk(result.messages.map(formatMessage), {
            key: triggerKey,
            correlationId,
            parentCorrelationId,
            siblingCount,
          });
          // break to finish the sequence if there are next steps
          break;
        } else {
          logger.error(`Invalid trigger key ${result.key} returned from handler`);
          res.status(400).send();
          return;
        }
      default:
        break;
    }

    // Resolve next step, ack if no more steps
    const nextStep = recipeMap.next(key);
    if (!nextStep) {
      logger.info(`No more steps in this sequence ${messageId}`);
      res.status(200).send();
      return;
    }

    // Trigger the next step with updated data
    await publishMessage({ ...message, data }, { key: nextStep, correlationId, parentCorrelationId, siblingCount });

    res.status(200).send();
    return;
  } catch (error) {
    if (error.rejected) {
      logger.error(
        `Rejected message with correlationId: ${correlationId}. Error: ${error}. Message: ${JSON.stringify(message)}`
      );
      await rejectMessage(
        { ...message, error: { message: error.extraMessage } },
        { key, correlationId, parentCorrelationId, siblingCount }
      );
      metrics.rejectedMessages.inc();

      res.status(200).send();
      return;
    }
    if (error.retry) {
      logger.warn(
        `Retrying message ${messageId} with correlationId: :${correlationId}. Error: ${error}. Message: ${JSON.stringify(
          message
        )}`
      );

      metrics.retriedMessages.inc();
      res.status(400).send();
      return;
    }
    if (error.unrecoverable) {
      try {
        // Trigger the unrecoverable handler by publishing a message with the .unrecoverable suffix
        await publishMessage(
          { ...message, error: { message: error.extraMessage } },
          { key: `${key}.unrecoverable`, correlationId, parentCorrelationId, siblingCount }
        );
        res.status(200).send();
        return;
      } catch (publishErr) {
        logger.error(
          `Unable to handle unrecoverable message with correlationId: ${correlationId}. Error: ${error}. Message: ${JSON.stringify(
            message
          )}`
        );
        res.status(500).send();
        return;
      }
    }
    if (deliveryAttempt < 10) {
      logger.warn(`Unexpected error attempt: ${deliveryAttempt} ${error.message}`);
    } else {
      logger.error(`Unexpected error ${error.message}`);
    }
    res.status(500).send();
    return;
  }
}

export default async function messageHandler(recipeMap, req, res) {
  const messageData = parseBody(req.body);
  const {
    messageId,
    attributes: { key },
  } = messageData;

  const correlationId = messageData.attributes.correlationId || getCorrelationId(messageData);

  const context = buildContext(correlationId, key);
  const { logger } = context;

  if (!key) {
    logger.error(`Got message without key ${messageId}`);
    res.status(400).send();
    return;
  }

  metrics.messages.inc();

  logger.info(`incoming message ${JSON.stringify(messageData)}`);
  const parts = key.split(".");
  const suffix = parts.pop();
  const [ prefix ] = parts;
  // Check if it is a trigger message and if so start the sequence at first step
  if (prefix === "trigger") {
    await handleTrigger(res, messageData, recipeMap, context, correlationId);
    return;
  }

  if (suffix === "unrecoverable") {
    await handleUnrecoverable(res, messageData, recipeMap, context, correlationId);
    return;
  } else if (suffix === "processed") {
    await handleProcessed(res, messageData, recipeMap, context, correlationId);
    return;
  }

  await handleMessage(res, messageData, recipeMap, context, correlationId);
  return;
}

function formatMessage(message) {
  return {
    ...message,
    data: [ ...(message.data ?? []) ],
    messages: undefined,
  };
}

function appendData(data, result) {
  const newData = [ ...data ];
  if (result && !result.key) {
    if (Array.isArray(result)) {
      newData.push(...result);
    } else {
      newData.push(result);
    }
  }
  return newData;
}

function parseBody(body) {
  const { message, subscription, deliveryAttempt } = body;
  const { attributes, data, messageId, publishTime } = message;
  const parsedData = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));

  return { subscription, attributes, messageId, publishTime, deliveryAttempt, message: parsedData };
}

function isValidDelay(delayMs) {
  if (!delayMs) return false;
  return delayMs >= 1000 && delayMs <= 1000 * 60 * 60;
}

async function startChildProcesses(result, parentCorrelationId, nextKey, message) {
  const children = result.messages.map((o) => ({
    message: o,
    attributes: { parentCorrelationId, correlationId: v4() },
  }));
  await jobStorage.storeParent(parentCorrelationId, children, message, nextKey);
  for (const child of children) {
    await publishMessage(child.message, {
      ...child.attributes,
      key: `trigger.${result.key}`,
      siblingCount: children.length.toString(), // because firestore needs it to be a string
    });
  }
}

function isValidResult(result, logger) {
  if (result?.type === "trigger") {
    if (!result.key) {
      logger.error("Invalid result: missing trigger key");
      return false;
    } else if (result.key.includes("sub-sequence") && !(result.messages && Array.isArray(result.messages))) {
      logger.error(`Invalid result: messages need to be an array got: ${JSON.stringify(result.messages)}`);
      return false;
    } else if (result.key.startsWith("sequence") && !(result.messages && Array.isArray(result.messages))) {
      logger.error("Invalid result: publishMessages must be an array");
      return false;
    } else if (result.messages && !Array.isArray(result.messages)) {
      logger.error(
        `Invalid result: invalid messages ${JSON.stringify(result.messages)} for handler that returns a trigger`
      );
      return false;
    }
  }
  return true;
}

function getCorrelationId(message) {
  let correlationId;

  if (!message.correlationId) {
    if (message.meta?.correlationId) {
      correlationId = message.meta.correlationId;
      delete message.meta.correlationId;
    } else {
      correlationId = v4();
    }
  } else {
    correlationId = message.correlationId;
  }

  return correlationId;
}
