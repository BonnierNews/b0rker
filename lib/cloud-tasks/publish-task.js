import { CloudTasksClient } from "@google-cloud/tasks";
import config from "exp-config";
import luLogger, { logger } from "lu-logger";
import gax from "google-gax";
import * as uuid from "uuid";

import { filterUndefinedNullValues } from "./utils.js";

const { queues, selfUrl, localPort } = config.cloudTasks || {};
const cloudTasksClient = new CloudTasksClient(
  localPort
    ? {
      port: localPort,
      servicePath: "localhost",
      sslCreds: gax.ChannelCredentials.createInsecure(),
    }
    : {},
  gax
);

// Google recommends to rate limit the amount of published tasks per second
const maxTasksPublishedPerSecond = 500;

export async function publishTasksBulk(taskUrl, messages) {
  const numTasks = messages.length;
  logger.info(`Will publish ${numTasks} tasks to ${taskUrl}`);

  const chunkSize = 100;

  for (let chunkStart = 0; chunkStart < numTasks; chunkStart += chunkSize) {
    const chunkEnd = Math.min(chunkStart + chunkSize, numTasks);
    logger.info(`Publishing tasks ${chunkStart}-${chunkEnd - 1} (of ${numTasks})`);

    const timer = setTimer(chunkSize / maxTasksPublishedPerSecond);
    await Promise.all(
      messages
        .slice(chunkStart, chunkEnd)
        .map(({ body, headers }, subSequenceNo) =>
          publishTask(taskUrl, body, { subSequenceNo, siblingCount: numTasks, ...headers })
        )
    );
    if (chunkEnd !== numTasks) await timer;
  }
  logger.info(`Published ${numTasks} tasks`);
}

export async function publishTask(taskUrl, body, headers = {}, queue = "default") {
  const url = `${selfUrl}/v2/${taskUrl.replace(/^\//, "")}`;
  const correlationId =
    headers.correlationId || headers["correlation-id"] || luLogger.debugMeta.getDebugMeta().correlationId;
  const newHeaders = {
    "Content-Type": "application/json",
    "correlation-id": correlationId,
    idempotencyKey: uuid.v4(),
    ...filterUndefinedNullValues(headers),
  };
  const queueName = queues[queue] || queues.default;
  logger.info(`Sending task ${JSON.stringify(body)} with headers ${JSON.stringify(newHeaders)} to ${url}`);
  await cloudTasksClient.createTask({
    parent: queueName,
    task: {
      name: taskNameFromUrl(taskUrl, queueName, correlationId, headers?.resendNumber),
      httpRequest: {
        httpMethod: "POST",
        headers: newHeaders,
        url,
        body: Buffer.from(JSON.stringify(body, null, 2)),
        dispatchDeadline: 30 * 60, // 30 minutes
      },
    },
  });
}

async function setTimer(delaySeconds) {
  return await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}

function taskNameFromUrl(url, queueName, correlationId, resendNumber) {
  // Task name can only contain letters, numbers, underscores and hyphens, and must be at most 500 characters
  const urlForName = url.replace(/^\//, ""); // Remove leading slash
  const suffix = resendNumber ? `__${correlationId}__re${resendNumber}` : `__${correlationId}`;
  const truncated = truncateName(urlForName, suffix);
  const truncatedAndNormalized = truncated.replace(/[^\w-]/g, "_");
  return `${queueName}/tasks/${truncatedAndNormalized}`;
}

function truncateName(name, suffix, maxLength = 500) {
  return (name.substring(0, maxLength - suffix.length) + suffix);
}
