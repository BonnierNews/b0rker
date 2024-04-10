import { publishTask } from "./publish-task.js";

export default async function resend(req, res) {
  const { relativeUrl, body, headers, queue } = req.body;
  await publishTask(relativeUrl, body, headers, queue);
  res.status(201).send();
}
