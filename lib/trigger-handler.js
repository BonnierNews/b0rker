import { v4 } from "uuid";

import publishMessage from "./publish-message.js";
import buildLogger from "./logger.js";

export async function trigger(recipeMap, req, res) {
  const key = resolveKey(recipeMap, req.params);
  const correlationId = resolveCorrelationId(req);
  const logger = buildLogger(correlationId);
  if (!key) {
    logger.error(`Got http trigger for an unknown sequence, ${key}, resolved from ${JSON.stringify(req.params)}`);
    return res.status(400).json({ error: `Unknown trigger key trigger.${Object.values(req.params).join(".")}` });
  }

  const message = req.body;
  logger.info(`incoming http trigger on ${key}`);

  await publishMessage({ ...message, data: [ ...(message.data ?? []) ] }, { key, correlationId });

  return res.status(200).send({ correlationId });
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
