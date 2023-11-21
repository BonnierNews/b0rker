import { v4 } from "uuid";
import joi from "joi";

import publishMessage, { publishMessagesBulk } from "./publish-message.js";
import buildLogger from "./logger.js";

export async function trigger(recipeMap, req, res) {
  const key = resolveKey(recipeMap, req.params);
  const correlationId = resolveCorrelationId(req);
  const logger = buildLogger(correlationId);
  if (!key) {
    logger.error(`Got http trigger for an unknown sequence, ${key}, resolved from ${req.params}`);
    return res.status(400).json({ error: `Unknown trigger key trigger.${Object.values(req.params).join(".")}` });
  }

  const message = req.body;
  logger.info(`incoming http trigger on ${key}`);

  await publishMessage({ ...message, data: [ ...(message.data ?? []) ] }, { key, correlationId });

  return res.sendStatus(200);
}

const triggerBulkSchema = joi.object({ messages: joi.array().items(joi.object()).required() });

export async function triggerBulk(recipeMap, req, res) {
  const key = resolveKey(recipeMap, req.params);
  const correlationId = resolveCorrelationId(req);

  const logger = buildLogger(correlationId);

  const { error: validationError } = triggerBulkSchema.validate(req.body);

  if (validationError) {
    logger.error(`got invalid body for bulk trigger with key: ${key}, ${validationError.message}`);
    return res.status(400).json({ error: validationError.message });
  }

  if (!key) {
    logger.error(`Got http trigger for an unknown sequence, ${key}, resolved from ${req.params}`);
    return res.status(400).json({ error: `Unknown trigger key trigger.${Object.values(req.params).join(".")}` });
  }

  logger.info(`incoming http bulk trigger on ${key} with ${req.body.messages.length} messages`);

  await publishMessagesBulk(req.body.messages, { key, correlationId });

  return res.sendStatus(200);
}

function resolveKey(recipeMap, { namespace, sequence, name }) {
  if (namespace && sequence) {
    return recipeMap.first(namespace, sequence);
  }

  return `trigger.${name}`;
}

function resolveCorrelationId({ headers }) {
  return headers["x-correlation-id"] || headers["correlation-id"] || v4();
}
