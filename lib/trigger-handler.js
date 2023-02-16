import { v4 } from "uuid";

import publishMessage from "./publish-message.js";
import buildLogger from "./logger.js";

export default async function triggerHandler(recipeMap, req, res) {
  const { namespace, sequence } = req.params;
  const key = `trigger.${namespace}.${sequence}`;
  const message = req.body;

  const correlationId = req.headers["x-correlation-id"] || v4();
  const logger = buildLogger(correlationId);
  logger.info(`incoming http trigger on ${key}`);
  const firstStep = recipeMap.first(namespace, sequence);
  if (!firstStep) {
    logger.error(`Got http trigger for an unknown sequence, ${key}`);
    return res.status(400).json({ error: `Unknown trigger key ${key}` });
  }
  await publishMessage({ ...message, data: [ ...(message.data ?? []) ] }, { key: firstStep, correlationId });
  return res.status(200).send();
}
