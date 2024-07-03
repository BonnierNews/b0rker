import config from "exp-config";
import { PubSub } from "@google-cloud/pubsub";
import { logger } from "lu-logger";

import { filterUndefinedNullValues } from "./utils/sequences.js";

const pubSubClient = new PubSub();

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
