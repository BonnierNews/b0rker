import { logger } from "lu-logger";

import { sendToDlx } from "./dlx.js";
import { publishTask } from "./publish-task.js";

export async function errorHandler(err, req, res, next) {
  if (!err) return next();

  if (err.rejected) {
    logger.info(`Rejected message: '${err.extraMessage}'. Message: ${JSON.stringify(req.body)}`);
    await sendToDlx(req, err.extraMessage);
    return res.status(200).send({ type: "reject", message: err.extraMessage });
  }

  if (err.retry) {
    logger.warning(`Retrying message: '${err.extraMessage}'. Message: ${JSON.stringify(req.body)}`);
    return res.status(400).send({ type: "retry", message: err.extraMessage });
  }

  if (err.unrecoverable) {
    logger.info(`Unrecoverable message with message: '${err.extraMessage}'. Message: ${JSON.stringify(req.body)}`);
    // Trigger the unrecoverable handler
    if (!req.attributes.key.endsWith(".unrecoverable")) {
      await publishTask(
        `${req.attributes.relativeUrl}/unrecoverable`,
        { ...req.body, error: { message: err.extraMessage } },
        { ...req.attributes }
      );
    }
    return res.status(200).send({ type: "unrecoverable", message: err.extraMessage });
  }

  if (err.message.startsWith("6 ALREADY_EXISTS: The task cannot be created because a task with this name existed too recently")) {
    logger.info(`Cloud tasks handled deduplication (this is OK): ${err.message}: ${err.stack}`);
    return res.status(200).send({ type: "already_published", message: err.message });
  }

  logger.error(`Unexpected error ${err.message}: ${err.stack}`);

  // If the request was not sent from cloud tasks, send it to the DLX so that it can be resent
  if (!req.attributes.queue) {
    const sequenceOrTrigger = req.attributes.relativeUrl.split("/").filter(Boolean).shift();
    await sendToDlx(req, `Failed to start ${sequenceOrTrigger}`);
  }

  return res.status(500).send({ type: "unknown", message: err.message });
}
