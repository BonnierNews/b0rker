import luLogger from "lu-logger";
import * as uuid from "uuid";

function getDebugMetadata(req) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId } = messageData.attributes || {};
  const correlationId = messageData.attributes?.correlationId || getCorrelationId(messageData, req.headers);
  const { messageId, deliveryAttempt } = messageData;

  return { key, resumedCount, correlationId, parentCorrelationId, messageId, deliveryAttempt };
}

function parseBody(body) {
  const { message, subscription, deliveryAttempt } = body;
  const { attributes, data, messageId, publishTime } = message || {};
  const parsedData = typeof data === "string" ? JSON.parse(Buffer.from(data, "base64").toString("utf-8")) : data;

  return { subscription, attributes, messageId, publishTime, deliveryAttempt, message: parsedData };
}

function getCorrelationId(message, headers = {}) {
  if (headers["x-correlation-id"]) return headers["x-correlation-id"];

  if (message.correlationId) return message.correlationId;

  if (message.meta?.correlationId) {
    const correlationId = message.meta.correlationId;
    delete message.meta.correlationId;
    return correlationId;
  }
  return uuid.v4();
}

export const debugMetaMiddleware = luLogger.debugMeta.initMiddleware(getDebugMetadata);
