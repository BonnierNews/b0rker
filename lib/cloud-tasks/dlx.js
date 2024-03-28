import { rejectMessage } from "../publish-message.js";

export async function sendToDlx(req, errorMessage) {
  await rejectMessage(
    { ...req.body, error: { message: errorMessage } },
    {
      key: req.attributes.key,
      correlationId: req.correlationId,
      origin: "cloudTasks",
      queue: req.attributes.queue,
    }
  );
}
