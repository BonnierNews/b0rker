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

  const urlParts = relativeUrlParts(req.originalUrl);
  req.attributes = {
    key: urlParts.join("."),
    relativeUrl: urlParts.join("/"),
    correlationId: req.correlationId,
    parentCorrelationId: req.header("parentCorrelationId"),
    grandParentCorrelationId: req.header("grandParentCorrelationId") || undefined,
    siblingCount: parseInt(req.header("siblingCount")) || undefined,
    parentSiblingCount: parseInt(req.header("parentSiblingCount")) || undefined,
    idempotencyKey: req.header("idempotencyKey"),
    subSequenceNo: req.header("subSequenceNo"),
    // `runId` is set (and passed on) to easily distinguish between different runs
    // of the same sequence with the same correlation ID
    runId: req.header("runId") || uuid.v4(),
    resendNumber: parseInt(req.header("resendNumber")) || undefined,
    retryCount: parseInt(req.header("x-cloudtasks-taskretrycount") || "0"),
    queue: req.header("x-cloudtasks-queuename"),
  };
  return next();
}

function relativeUrlParts(originalUrl) {
  const urlParts = originalUrl.split("/");
  return urlParts.slice(urlParts.lastIndexOf("v2") + 1);
}
