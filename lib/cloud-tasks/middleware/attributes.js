import * as uuid from "uuid";

function extractCorrelationId(req) {
  return (
    req.get("correlation-id") || req.get("x-correlation-id") || req.body?.correlationId || req.body?.meta?.correlationId
  );
}

export function setAttributes(req, res, next) {
  let correlationId = extractCorrelationId(req);
  if (!correlationId) {
    correlationId = uuid.v4();
    req.setNewCorrelationId = true;
  }
  req.correlationId = correlationId;
  res.set("correlation-id", correlationId);

  req.attributes = {
    key: req.originalUrl.replaceAll("/", ".").replace(/^\./, ""),
    correlationId: req.correlationId,
    ...getHeader(req, "parentCorrelationId"),
    ...getHeader(req, "siblingCount"),
    ...getHeader(req, "x-cloudtasks-taskretrycount"),
  };
  return next();
}

function getHeader(req, name) {
  const header = req.header(name);
  return header && { name: header };
}
