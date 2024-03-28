import config from "exp-config";
import { logger } from "lu-logger";

import { sendToDlx } from "../dlx.js";

const maxRetries = config.maxRetries || 10;

export async function sendToDlxMiddleware(req, res, next) {
  if (req.attributes.retryCount > maxRetries) {
    logger.error("Max retries reached, sending to DLX");
    await sendToDlx(req, "Max retries reached");

    return res.status(200).send({ type: "dlx", message: "Max retries reached" });
  }
  next();
}
