import { CloudTasksClient } from "@google-cloud/tasks";
import config from "exp-config";
import luLogger, { logger } from "lu-logger";
import gax from "google-gax";
import * as uuid from "uuid";
import crypto from "crypto";

import { filterUndefinedNullValues } from "./utils.js";
import setTimer from "../utils/timer.js";
import withRetries from "../utils/retry.js";

const { queues, selfUrl, localPort, useHttpFallback } = config.cloudTasks || {};
const cloudTasksClient = getCloudTasksClient();

function getCloudTasksClient() {
  if (useHttpFallback) return new CloudTasksClient({ fallback: true });
  return new CloudTasksClient(
    localPort
      ? {
          port: localPort,
          servicePath: "localhost",
          sslCreds: gax.ChannelCredentials.createInsecure(),
        }
      : {},
    gax
  );
}

// Google recommends to rate limit the amount of published tasks per second
const maxTasksPublishedPerSecond = 500;
const maxRetries = config.cloudTasks?.maxPublicationRetries ?? 5;

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
  const cloudTasksDeduplicationErrors = [
    "Requested entity already exists",
    "The task cannot be created because a task with this name existed too recently",
  ];
  await withRetries(
    async () => {
      try {
        await _publishTask(taskUrl, body, headers, queue);
      } catch (err) {
        if (cloudTasksDeduplicationErrors.some((msg) => err.message?.includes(msg))) {
          logger.warning(`Cloud tasks handled deduplication (this should be OK): ${err.message}: ${err.stack}`);
          return;
        }
        throw err;
      }
    },
    { maxRetries }
  );
}

async function _publishTask(taskUrl, body, headers = {}, queue = "default") {
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
  await cloudTasksClient.createTask(
    {
      parent: queueName,
      task: {
        name: buildTaskName(taskUrl, body, queueName, correlationId, headers?.resendNumber),
        httpRequest: {
          httpMethod: "POST",
          headers: newHeaders,
          url,
          body: Buffer.from(JSON.stringify(body, null, 2)),
          dispatchDeadline: 30 * 60, // 30 minutes
        },
      },
    },
    { retry: { backoffSettings: { maxRetries: 5, initialRetryDelayMillis: 1000, retryDelayMultiplier: 2 } } }
  );
}

function buildTaskName(url, body, queueName, correlationId, resendNumber) {
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
