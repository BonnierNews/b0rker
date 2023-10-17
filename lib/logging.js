import luLogger from "lu-logger";
import * as uuid from "uuid";

function getDebugMetadata(req) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId } = messageData.attributes;
  const correlationId = messageData.attributes.correlationId || getCorrelationId(messageData);
  const { messageId, deliveryAttempt } = messageData;

  return { key, resumedCount, correlationId, parentCorrelationId, messageId, deliveryAttempt };
}

function parseBody(body) {
  const { message, subscription, deliveryAttempt } = body;
  const { attributes, data, messageId, publishTime } = message;
  const parsedData = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));

  return { subscription, attributes, messageId, publishTime, deliveryAttempt, message: parsedData };
}

function getCorrelationId(message) {
  let correlationId;

  if (!message.correlationId) {
    if (message.meta?.correlationId) {
      correlationId = message.meta.correlationId;
      delete message.meta.correlationId;
    } else {
      correlationId = uuid.v4();
    }
  } else {
    correlationId = message.correlationId;
  }

  return correlationId;
}

export const debugMetaMiddleware = luLogger.debugMeta.initMiddleware(getDebugMetadata);
