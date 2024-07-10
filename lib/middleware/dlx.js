import { ackAndSendToDlx, shouldSendToDlx } from "../dlx.js";

export async function sendToDlxMiddleware(req, res, next) {
  if (shouldSendToDlx(req)) {
    return await ackAndSendToDlx(req, res);
  }
  next();
}
