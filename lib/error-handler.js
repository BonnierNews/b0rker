import { logger } from "lu-logger";

import { ackAndSendToDlx, sendToDlx, shouldSendToDlx } from "./dlx.js";
import { publishTask } from "./publish-task.js";

export async function errorHandler(err, req, res, next) {
  if (!err) return next();

  if (err.rejected) {
    logger.info(`Rejected message: '${err.extraMessage}'`);
    await sendToDlx(req, err.extraMessage);
    return res.status(200).send({ type: "reject", message: err.extraMessage });
  }

  if (err.retry) {
    if (shouldSendToDlx(req, { nextTime: true })) {
      return await ackAndSendToDlx(req, res, err);
    } else {
      logger.warning(`Retrying message: '${err.extraMessage}' `);
      return res.status(400).send({ type: "retry", message: err.extraMessage });
    }
  }

  if (err.unrecoverable) {
    logger.info(`Unrecoverable message with message: '${err.extraMessage}'  `);
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

  if (err.validation) {
    logger.error(`Validation error: ${err.message}`);
    await sendToDlx(req, `Validation error: ${err.message}`);
    return res.status(200).send({ type: "validation_error", message: err.message });
  }

  logger.error(`Unexpected error ${err.message}: ${err.stack}`);

  // If the request was not sent from cloud tasks, send it to the DLX so that it can be resent
  if (!req.attributes.queue) {
    const sequenceOrTrigger = req.attributes.relativeUrl.split("/").filter(Boolean).shift();
    await sendToDlx(req, `Failed to start ${sequenceOrTrigger}`);
  }

  if (shouldSendToDlx(req, { nextTime: true })) {
    return await ackAndSendToDlx(req, res, err);
  }

  return res.status(500).send({ type: "unknown", message: err.message });
}
