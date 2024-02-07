import { PubSub } from "@google-cloud/pubsub";
import config from "exp-config";
import * as uuid from "uuid";

import buildLogger from "./logger.js";

const pubSubClient = config.pubSub ? new PubSub({ apiEndpoint: config.pubSub.apiEndpoint }) : new PubSub();

const cleanupAttributes = (attributes) => JSON.parse(JSON.stringify(attributes));

export default async function publishMessage(message, attributes) {
  const logger = buildLogger(attributes.correlationId);
  const messageId = await publishPubsubMessage(
    pubSubClient.topic(config.topic),
    { json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic, idempotencyKey: uuid.v4() }) },
    logger
  );
  logger.info(`Published message ${messageId}`);
}

export async function rejectMessage(message, attributes) {
  const logger = buildLogger(attributes.correlationId);
  const messageId = await publishPubsubMessage(
    pubSubClient.topic(config.deadLetterTopic),
    { json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic }) },
    logger
  );
  logger.error(`Rejected message ${messageId}`);
}

export async function publishMessagesBulk(messages, attributes) {
  const client = await pubSubClient.topic(config.topic, {
    batching: {
      maxMessages: 1000,
      maxMilliseconds: 10,
    },
  });
  const promises = messages.map((message, idx) =>
    (async () => {
      const correlationId = `${attributes.correlationId}:${idx}`;
      const logger = buildLogger(correlationId);
      const messageId = await publishPubsubMessage(
        client, {
          json: message,
          attributes: cleanupAttributes({ ...attributes, correlationId, topic: config.topic, idempotencyKey: uuid.v4() }),
        },
        logger
      );
      logger.info(`Published message ${messageId}`);
    })()
  );

  await Promise.all(promises);
}

async function publishPubsubMessage(topicClient, message, logger) {
  try {
    return await topicClient.publishMessage(message);
  } catch (err) {
    logger.error(`Error publishing PubSub message: "${err}". Full message: ${JSON.stringify(message)}`);
    throw err;
  }
}
