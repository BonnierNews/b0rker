import { PubSub } from "@google-cloud/pubsub";
import config from "exp-config";

import buildLogger from "./logger.js";

const pubSubClient = config.pubSub ? new PubSub({ apiEndpoint: config.pubSub.apiEndpoint }) : new PubSub();

const cleanupAttributes = (attributes) => JSON.parse(JSON.stringify(attributes));

export default async function publishMessage(message, attributes) {
  const messageId = await pubSubClient
    .topic(config.topic)
    .publishMessage({ json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic }) });
  buildLogger(message.correlationId).info(`Published message ${messageId}`);
}

export async function rejectMessage(message, attributes) {
  const messageId = await pubSubClient
    .topic(config.deadLetterTopic)
    .publishMessage({ json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic }) });
  buildLogger(message.correlationId).error(`Rejected message ${messageId}`);
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
      const messageId = await client.publishMessage({ json: message, attributes: cleanupAttributes({ ...attributes, correlationId, topic: config.topic }) });
      buildLogger(correlationId).info(`Published message ${messageId}`);
    })()
  );

  await Promise.all(promises);
}
