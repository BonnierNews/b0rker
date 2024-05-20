import camelCase from "camelcase";

import { filterUndefinedNullValues } from "../utils.js";

export function setDebugMeta(req, res, next) {
  const debugPrefix = "x-debug-meta";

  const debugMetaPrefixRegExp = new RegExp(`^${debugPrefix}-`);

  const meta = filterUndefinedNullValues(req.attributes);

  for (const [ headerName, headerValue ] of Object.entries(req.headers)) {
    if (headerName.startsWith(debugPrefix) && headerName !== `${debugPrefix}-correlation-id`) {
      meta[headerName.replace(debugMetaPrefixRegExp, "")] = headerValue;
    }

    if (headerName.startsWith("x-cloudtasks-")) {
      meta[camelCase(headerName.replace("x-", ""))] = headerValue;
    }

    if (headerName === "x-goog-authenticated-user-email") {
      meta.clientServiceAccount = headerValue;
    }
  }

  req.debugMeta = meta;
  return next();
}
