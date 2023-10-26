import luLogger from "lu-logger";
import * as uuid from "uuid";

import { parseBody } from "./utils.js";

function getDebugMetadata(req) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId } = messageData.attributes || {};
  const correlationId = messageData.attributes?.correlationId || getCorrelationId(messageData, req.headers);
  const { messageId, deliveryAttempt } = messageData;

  return { key, resumedCount, correlationId, parentCorrelationId, messageId, deliveryAttempt };
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
