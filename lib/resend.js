import { publishTask } from "./publish-task.js";

export default async function resend(req, res) {
  const { relativeUrl, body, headers, queue } = req.body;
  const resendNumber = parseInt(headers?.resendNumber || "0") + 1;
  await publishTask(relativeUrl, body, { ...headers, resendNumber }, queue);
  res.status(201).send();
}
