export function parseBody(body) {
  const { message, subscription, deliveryAttempt } = body;
  const { attributes, data, messageId, publishTime } = message || {};
  const parsedData = typeof data === "string" ? JSON.parse(Buffer.from(data, "base64").toString("utf-8")) : data;

  return { subscription, attributes, messageId, publishTime, deliveryAttempt, message: parsedData };
}
