import { v4 } from "uuid";

import publishMessage from "./publish-message.js";
import buildLogger from "./logger.js";

export default async function triggerHandler(recipeMap, req, res) {
  const { namespace, sequence } = req.params;
  const key = `trigger.${namespace}.${sequence}`;
  const message = req.body;

  ensureMessageCorrelation(message, req.headers);
  const logger = buildLogger(message.correlationId);
  logger.info(`incoming http trigger on ${key}`);
  const firstStep = recipeMap.first(namespace, sequence);
  if (!firstStep) {
    logger.error(`Got http trigger for an unknown sequence, ${key}`);
    return res.status(400).json({ error: `Unknown trigger key ${key}` });
  }
  await publishMessage({ ...message, data: [ ...(message.data ?? []) ] }, { key: firstStep });
  return res.status(200).send();
}

function ensureMessageCorrelation(message, headers) {
  if (message.correlationId) {
    return;
  } else if (headers["x-correlation-id"]) {
    message.correlationId = headers["x-correlation-id"];
  } else if (message.meta?.correlationId) {
    message.correlationId = message.meta.correlationId;
    delete message.meta.correlationId;
  } else {
    message.correlationId = v4();
  }
}
