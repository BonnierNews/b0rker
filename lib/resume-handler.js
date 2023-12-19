import { logger } from "lu-logger";

import publishMessage from "./publish-message.js";

export default async function resumeHandler(req, res) {
  logger.info(`Got resume message body ${JSON.stringify(req.body)}`);
  const { message, key, resumedCount } = req.body;
  await publishMessage(message, { key, resumedCount: String(resumedCount) });
  return res.status(200).send();
}
