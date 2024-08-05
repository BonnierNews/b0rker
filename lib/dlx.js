import { PubSub } from "@google-cloud/pubsub";
import config from "exp-config";
import { logger } from "lu-logger";

import { filterUndefinedNullValues } from "./utils/sequences.js";

const maxRetries = config.maxRetries || 10;
const pubSubClient = new PubSub();

export function shouldSendToDlx(req, { nextTime = false } = {}) {
  const secondOrLaterAttemptWithoutRetries = Boolean(req.headers["x-no-retry"]) && req.attributes.retryCount > 0;
  const maxRetriesReached = req.attributes.retryCount + (nextTime ? 1 : 0) > maxRetries;
  return secondOrLaterAttemptWithoutRetries || maxRetriesReached;
}

export async function sendToDlx(req, errorMessage) {
  const message = errorMessage || req.body?.error?.message;
  const attributes = Object.fromEntries(
    Object.entries(filterUndefinedNullValues(req.attributes)).map(([ key, value ]) => [ key, value.toString() ])
  );

  const pubsubClient = pubSubClient.topic(config.deadLetterTopic);

  try {
    await pubsubClient.publishMessage({
      json: { ...req.body, error: { ...req.body?.error, message } },
      attributes: { origin: "cloudTasks", appName: config.appName, ...attributes },
    });
    logger.warning("Sent message to DLX");
  } catch (err) {
    logger.error(`Error publishing PubSub message: "${err}". Full message: ${JSON.stringify(message)}`);
    throw err;
  }
}

export async function ackAndSendToDlx(req, res, err) {
  logger.error("Max retries reached, sending to DLX.");
  const retryMessage = err?.extraMessage
    ? `Max retries reached. Last message: "${err.extraMessage}"`
    : "Max retries reached";
  await sendToDlx(req, retryMessage);
  return res.status(200).send({ type: "dlx", message: retryMessage });
}
