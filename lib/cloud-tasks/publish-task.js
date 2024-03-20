import { CloudTasksClient } from "@google-cloud/tasks";
import config from "exp-config";
import luLogger, { logger } from "lu-logger";
import gax from "google-gax";
import * as uuid from "uuid";

import { filterUndefinedNullValues } from "./utils.js";

const { queue, selfUrl, localPort } = config.cloudTasks || {};
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
  logger.info(`Will publish ${numTasks} tasks`);

  const chunkSize = 100;

  for (let chunkStart = 0; chunkStart < numTasks; chunkStart += chunkSize) {
    const chunkEnd = Math.min(chunkStart + chunkSize, numTasks);
    logger.info(`Publishing tasks ${chunkStart}-${chunkEnd - 1} (of ${numTasks})`);

    const timer = setTimer(chunkSize / maxTasksPublishedPerSecond);
    await Promise.all(
      messages.slice(chunkStart, chunkEnd).map(({ body, headers }) => publishTask(taskUrl, body, headers))
    );
    if (chunkEnd !== numTasks) await timer;
  }
  logger.info(`Published ${numTasks} tasks`);
}

export async function publishTask(taskUrl, body, headers = {}) {
  const url = `${selfUrl}/${taskUrl.replace(/^\//, "")}`;
  const { correlationId } = luLogger.debugMeta.getDebugMeta();
  logger.info(`Sending task ${JSON.stringify(body)} with headers ${JSON.stringify(headers)} to ${url}`);
  await cloudTasksClient.createTask({
    parent: queue,
    task: {
      httpRequest: {
        httpMethod: "POST",
        headers: {
          "Content-Type": "application/json",
          "correlation-id": correlationId,
          idempotencyKey: uuid.v4(),
          ...filterUndefinedNullValues(headers),
        },
        url,
        body: Buffer.from(JSON.stringify(body)),
      },
    },
  });
}

async function setTimer(delaySeconds) {
  return await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}
