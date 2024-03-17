import { logger } from "lu-logger";

export function logMessageMiddleware(req, res, next) {
  logger.info(`Got message on ${req.originalUrl}: ${JSON.stringify(req.body)}`);
  next();
}
