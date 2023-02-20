import { PubSub } from "@google-cloud/pubsub";
import config from "exp-config";

import buildLogger from "./logger.js";

const pubSubClient = config.pubSub ? new PubSub({ apiEndpoint: config.pubSub.apiEndpoint }) : new PubSub();

const cleanupAttributes = (attributes) => JSON.parse(JSON.stringify(attributes));

export default async function publishMessage(message, attributes) {
  const messageId = await pubSubClient.topic(config.topic).publishMessage({ json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic }) });
  buildLogger(message.correlationId).info(`Published message ${messageId}`);
}

export async function rejectMessage(message, attributes) {
  const messageId = await pubSubClient.topic(config.deadLetterTopic).publishMessage({ json: message, attributes: cleanupAttributes({ ...attributes, topic: config.topic }) });
  buildLogger(message.correlationId).error(`Rejected message ${messageId}`);
}
