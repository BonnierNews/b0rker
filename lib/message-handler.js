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

export default async function messageHandler(recipeMap, req, res) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId, siblingCount } = messageData.attributes;
  const correlationId = messageData.attributes.correlationId || getCorrelationId(messageData);
  const { messageId, message, deliveryAttempt } = messageData;
  const context = buildContext(correlationId, key);

  const { logger } = context;

  if (!key) {
    logger.error(`Got message without key ${messageId}`);
    return res.status(400).send();
  }

  metrics.messages.inc();

  logger.info(`incoming message ${JSON.stringify(messageData)}`);
  const parts = key.split(".");
  const suffix = parts.pop();
  const [ prefix ] = parts;
  // Check if it is a trigger message and if so start the sequence at first step
  if (prefix === "trigger") {
    const triggerHandler = recipeMap.triggerHandler(key);
    const triggerResult = await runTrigger(triggerHandler, message, context);
    if (triggerHandler && !triggerResult) {
      logger.info(`Found nothing to trigger for message ${messageId}`);
      return res.status(200).send();
    }
    const { key: triggerKey, messages, error } = triggerResult;
    if (error) {
      logger.error(
        `Got error running trigger for message with correlationId: ${correlationId}. Error: ${error}. Message: ${message}`
      );
      return res.status(400).send();
    }

    const [ , namespace, name ] = triggerKey?.split(".") || key.split(".");
    const firstStep = recipeMap.first(namespace, name);
    if (!firstStep) {
      logger.error(`Got trigger message for an unknown sequence, ${messageId}`);
      return res.status(400).send();
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

    return res.status(200).send();
  }

  if (suffix === "unrecoverable") {
    const prevKey = key.split(".").slice(0, -1).join(".");
    const unrecoverableHandler = recipeMap.unrecoverableHandler(prevKey);
    if (typeof unrecoverableHandler !== "function") {
      return res.status(400).send();
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
      return res.status(500).send();
    }

    return res.status(200).send();
  } else if (suffix === "processed") {
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
        logger.info(`Checking if parent ${parentCorrelationId} is finished ${messageId}`);
        const { isLast, parentData, completedJobCount } = await jobStorage.parentIsComplete({
          parentCorrelationId,
          key,
          siblingCount,
        });
        logger.info(`Reporting that ${completedJobCount} children are complete`);
        logger.info(`Parent is complete: ${isLast}`);
        if (isLast) {
          logger.info(`Parent data: ${JSON.stringify(parentData)}`);
          // TODO: SIVA we should delete the jobs that were stored here
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
        return res.status(502).send(); // TODO: this doesn't seem to do anything in tests
      }
    }
    metrics.processedSequences.inc();
    return res.status(200).send();
  }

  // Resolve and invoke the handler for this step
  const handler = recipeMap.handler(key);
  try {
    const result = await handler(message, context);

    if (!isValidResult(result, logger)) {
      logger.error(`Got invalid result from handler on key: ${key}, result: ${JSON.stringify(result)}`);
      return res.status(400).send();
    }

    const data = appendData(message.data, result, key);

    switch (result?.type) {
      // Handle resume result returned from handler
      case "resume":
        if (Number(resumedCount) >= maxResumeCount) {
          logger.error(`Message delayed for max amount ${maxResumeCount} of times`);
          await rejectMessage(
            { ...message, error: `To many resume retries. Retries: ${resumedCount}` },
            { key, correlationId, parentCorrelationId, siblingCount }
          );
          return res.status(200).send();
        }
        if (!isValidDelay(result.delayMs)) {
          logger.error(`Invalid delayMs ${result.delayMs} returned from handler`);
          return res.status(400).send();
        }
        await resumeMessage(key, message, Number(resumedCount), result.delayMs, logger);
        return res.status(200).send();
      // Handle trigger result returned from handler
      case "trigger":
        if (result.key.startsWith("sub-sequence")) {
          if (!result.messages?.length) break; // skip to next step if no messages

          await startChildProcesses(result, `${key}:${correlationId}`, recipeMap.next(key), {
            ...message,
            data,
          });
          return res.status(200).send();
        } else if (result.key.startsWith("sequence")) {
          const triggerKey = recipeMap.first(...result.key.split("."));
          if (!triggerKey) {
            logger.error(`Got trigger message for an unknown sequence, ${result.key}`);
            return res.status(400).send();
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
          return res.status(400).send();
        }
      default:
        break;
    }

    // Resolve next step, ack if no more steps
    const nextStep = recipeMap.next(key);

    if (!nextStep) {
      logger.info(`No more steps in this sequence ${messageId}`);
      return res.status(200).send();
    }

    // Trigger the next step with updated data

    await publishMessage({ ...message, data }, { key: nextStep, correlationId, parentCorrelationId, siblingCount });

    return res.status(200).send();
  } catch (error) {
    if (error.rejected) {
      logger.error(`Rejected message with correlationId: ${correlationId}. Error: ${error}. Message: ${message}`);
      await rejectMessage(
        { ...message, error: { message: error.extraMessage } },
        { key, correlationId, parentCorrelationId, siblingCount }
      );
      metrics.rejectedMessages.inc();
      return res.status(200).send();
    }
    if (error.retry) {
      logger.warn(
        `Retrying message ${messageId} with correlationId: :${correlationId}. Error: ${error}. Message: ${message}`
      );
      metrics.retriedMessages.inc();
      return res.status(400).send();
    }
    if (error.unrecoverable) {
      try {
        // Trigger the unrecoverable handler by publishing a message with the .unrecoverable suffix
        await publishMessage(
          { ...message, error: { message: error.extraMessage } },
          { key: `${key}.unrecoverable`, correlationId, parentCorrelationId, siblingCount }
        );
        return res.status(200).send();
      } catch (publishErr) {
        logger.error(
          `Unable to handle unrecoverable message with correlationId: ${correlationId}. Error: ${error}. Message: ${message}`
        );
        return res.status(500).send();
      }
    }
    if (deliveryAttempt < 10) {
      logger.warn(`Unexpected error attempt: ${deliveryAttempt} ${error.message}`);
    } else {
      logger.error(`Unexpected error ${error.message}`);
    }
    return res.status(500).send();
  }
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
      logger.error(`Invalid result: messages need to be an array got: ${result.messages}`);
      return false;
    } else if (result.key.startsWith("sequence") && !(result.messages && Array.isArray(result.messages))) {
      logger.error("Invalid result: publishMessages must be an array");
      return false;
    } else if (result.messages && !Array.isArray(result.messages)) {
      logger.error(`Invalid result: invalid messages ${result.messages} for handler that returns a trigger`);
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
