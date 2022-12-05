import {CloudTasksClient} from "@google-cloud/tasks";
import config from "exp-config";

const client = new CloudTasksClient();
const {taskQueue, selfUrl, serviceAccountEmail} = config;

export default async function (key, message, resumedCount, delayMs, logger) {
  const url = `${selfUrl}/resume-message`;
  const payload = {
    key,
    message,
    resumedCount: (resumedCount || 0) + 1
  };

  const task = {
    httpRequest: {
      httpMethod: "POST",
      url,
      oidcToken: {
        serviceAccountEmail
      },
      body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      headers: {
        "Content-Type": "application/json"
      }
    },
    scheduleTime: {
      seconds: (delayMs + Date.now()) / 1000
    }
  };

  const request = {parent: taskQueue, task: task};
  const [response] = await client.createTask(request);
  logger.info(`Created task for resume message ${JSON.stringify(response)}`);
}
