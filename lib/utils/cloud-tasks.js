import crypto from "crypto";

export function buildTaskName(url, body, queueName, correlationId, resendNumber) {
  // Task name can only contain letters, numbers, underscores and hyphens, and must be at most 500 characters
  const urlForName = url.replace(/^\//, ""); // Remove leading slash
  const hash = createMessageHash(body);
  const resendSuffix = resendNumber ? `__re${resendNumber}` : "";
  const suffix = `__${hash}__${correlationId}${resendSuffix}`;

  const truncated = truncateName(urlForName, suffix);
  const truncatedAndNormalized = truncated.replace(/[^\w-]/g, "_");
  return `${queueName}/tasks/${truncatedAndNormalized}`;
}

function createMessageHash(message) {
  return crypto.createHash("sha256").update(JSON.stringify(message)).digest("base64");
}

function truncateName(name, suffix, maxLength = 500) {
  return name.substring(0, maxLength - suffix.length) + suffix;
}

export default { buildTaskName };
