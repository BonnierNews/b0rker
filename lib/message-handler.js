import config from "exp-config";
import { v4 } from "uuid";

import publishMessage, { rejectMessage } from "./publish-message.js";
import resumeMessage from "./resume-message.js";
import buildContext from "./context.js";
import jobStorage from "./job-storage/index.js";

const maxResumeCount = config.maxResumeCount || 10;

export default async function messageHandler(recipeMap, req, res) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId } = messageData.attributes;
  const correlationId = messageData.attributes.correlationId || getCorrelationId(messageData);
  const { messageId, message, deliveryAttempt } = messageData;
  const context = buildContext(correlationId, key);
  const { logger } = context;

  if (!key) {
    logger.error(`Got message without key ${messageId}`);
    return res.status(400).send();
  }
  logger.info(`incoming message ${JSON.stringify(messageData)}`);
  const parts = key.split(".");
  // Check if it is a trigger message and if so start the sequence at first step
  if (parts.shift() === "trigger") {
    const [ , namespace, name ] = key.split(".");
    const firstStep = recipeMap.first(namespace, name);
    if (!firstStep) {
      logger.error(`Got trigger message for an unknown sequence, ${messageId}`);
      return res.status(400).send();
    }

    await publishMessage(
      { ...message, data: [ ...(message.data ?? []) ] },
      { key: firstStep, correlationId, parentCorrelationId }
    );
    return res.status(200).send();
  }

  // Last message of each sequence has a *.processed key
  if (parts.pop() === "processed") {
    logger.info(`The sequence is finished ${messageId}`);
    const [ sequence ] = key.split(".");

    // Handle if the finished sequence is a sub-sequence that was triggered by another sequence
    if (sequence === "sub-sequence" && parentCorrelationId) {
      logger.info(`sub-sequence triggered from parent is finished, calling job storage to complete child ${messageId}`);
      const [ isLast, parentData ] = await jobStorage.completedChild(message, { parentCorrelationId, correlationId });
      if (isLast) {
        await publishMessage(parentData.message, { key: parentData.nextKey, correlationId, parentCorrelationId });
        // TODO: should we delete the job that was stored here
      }
    }
    return res.status(200).send();
  }

  // Resolve and invoke the handler for this step
  const handler = recipeMap.handler(key);
  try {
    const result = await handler(message, context);
    if (!isvalidResult(key, result, logger)) {
      logger.error(`Got invalid result from handler on key: ${key}, result: ${JSON.stringify(result)}`);
      return res.status(400).send();
    }

    const newData = [ ...message.data ];
    if (result) {
      if (Array.isArray(result)) {
        newData.push(...result);
      } else {
        newData.push(result);
      }
    }

    switch (result?.type) {
      // Handle resume result returned from handler
      case "resume":
        if (Number(resumedCount) >= maxResumeCount) {
          logger.error(`Message delayed for max amount ${maxResumeCount} of times`);
          await rejectMessage({ ...message, error: `To many resume retries. Retries: ${resumedCount}` }, { key });
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
        await startChildProccesses(result, `${key}:${correlationId}`, recipeMap.next(key), {
          ...message,
          data: newData,
        });
        return res.status(200).send();
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

    await publishMessage({ ...message, data: newData }, { key: nextStep, correlationId, parentCorrelationId });

    return res.status(200).send();
  } catch (error) {
    if (error.rejected) {
      logger.error(`Rejected message with correlationId: ${correlationId}. Error: ${error}. Message: ${message}`);
      await rejectMessage({ ...message, error: JSON.stringify(error) }, { key });
      return res.status(200).send();
    }
    if (error.retry) {
      logger.info(`Retrying message ${messageId}`);
      return res.status(400).send();
    }
    if (deliveryAttempt < 10) {
      logger.warn(`Unexpected error attempt: ${deliveryAttempt} ${error.message}`);
    } else {
      logger.error(`Unexpected error ${error.message}`);
    }
    return res.status(500).send();
  }
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

async function startChildProccesses(result, parentCorrelationId, nextKey, message) {
  const children = result.source.map((o) => ({ message: o, attributes: { parentCorrelationId, correlationId: v4() } }));
  await jobStorage.storeParent(parentCorrelationId, children, message, nextKey);
  for (const child of children) {
    await publishMessage(child.message, { ...child.attributes, key: `trigger.${result.key}` });
  }
}

function isvalidResult(key, result, logger) {
  if (result?.type === "trigger") {
    const [ , , verb ] = key.split(".");
    if (verb !== "trigger-sub-sequence") {
      logger.error(
        `Invalid result: invalid verb ${verb} for handler that returns a trigger. Verb must be trigger-sub-sequence.`
      );
      return false;
    }
    if (!result.source || !Array.isArray(result.source)) {
      logger.error(`Invalid result: invalid source ${result.source} for handler that returns a trigger`);
      return false;
    }
    if (result.key.split(".")[0] !== "sub-sequence") {
      logger.error("Invalid result: key that is triggered must be a sub-sequence");
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
