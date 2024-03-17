import camelCase from "camelcase";

export function setDebugMeta(req, res, next) {
  const debugPrefix = "x-debug-meta";

  const debubMetaPrefixRegExp = new RegExp(`^${debugPrefix}-`);

  const meta = { ...req.attributes };

  for (const [ headerName, headerValue ] of Object.entries(req.headers)) {
    if (headerName.startsWith(debugPrefix) && headerName !== `${debugPrefix}-correlation-id`) {
      meta[headerName.replace(debubMetaPrefixRegExp, "")] = headerValue;
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
