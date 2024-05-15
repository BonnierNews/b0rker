import config from "exp-config";

import { rejectMessage } from "../publish-message.js";
import { filterUndefinedNullValues } from "./utils.js";

export async function sendToDlx(req, errorMessage) {
  const message = errorMessage || req.body?.error?.message;
  await rejectMessage(
    { ...req.body, error: { ...req.body?.error, message } },
    {
      origin: "cloudTasks",
      appName: config.appName,
      ...Object.fromEntries(
        Object.entries(filterUndefinedNullValues(req.attributes)).map(([ key, value ]) => [ key, value.toString() ])
      ),
    }
  );
}
