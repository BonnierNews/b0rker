import luLogger from "lu-logger";
import * as uuid from "uuid";
import camelcase from "camelcase";

import { parseBody } from "./utils.js";

const debugPrefix = "x-debug-meta";

function getDebugMetadata(req) {
  const messageData = parseBody(req.body);
  const { key, resumedCount, parentCorrelationId } = messageData.attributes || {};
  const correlationId = messageData.attributes?.correlationId || getCorrelationId(messageData, req.headers);
  const { messageId, deliveryAttempt } = messageData;
  const debugMetaHeaders = getDebugMetaHeaders(req.headers);

  return { key, resumedCount, correlationId, parentCorrelationId, messageId, deliveryAttempt, ...debugMetaHeaders };
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

function getDebugMetaHeaders(headers) {
  const debugMetaHeaders = { };
  for (const header of Object.keys(headers)) {
    if (header.startsWith(debugPrefix) && header !== `${debugPrefix}-correlation-id`) {
      debugMetaHeaders[debugKey(header)] = headers[header];
    }
  }
  return debugMetaHeaders;
}

function debugKey(header) {
  const prefixRegExp = new RegExp(`^${debugPrefix}-`);
  return camelcase(header.replace(prefixRegExp, ""));
}

export const debugMetaMiddleware = luLogger.debugMeta.initMiddleware(getDebugMetadata);
