import { logger } from "lu-logger";

export function logMessageMiddleware(req, res, next) {
  logger.info(`Got message on ${req.originalUrl}: ${JSON.stringify(req.body)}`);
  next();
}

export function logRequest(req, res, next) {
  const time = new Date();

  function afterResponse() {
    res.removeListener("finish", afterResponse);
    res.removeListener("close", afterResponse);

    if (!res.finished) {
      logger.info(`"${req.method} ${req.originalUrl}" NO RESPONSE SENT ${new Date() - time} ms`, req.debugMeta);
    } else {
      logger.info(`"${req.method} ${req.originalUrl}" ${res.statusCode} ${new Date() - time} ms`, req.debugMeta);
    }
  }

  res.on("finish", afterResponse);
  res.on("close", afterResponse);

  next();
}
