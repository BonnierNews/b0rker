import GoogleAuth from "google-auth-library";
import util from "util";
import config from "exp-config";
import axios from "axios";
import assert from "assert";

import buildLogger from "./logger.js";

const auth = new GoogleAuth.GoogleAuth();

async function performRequest(method, params) {
  const logger = buildLogger(params.correlationId, params.key);

  const { url, audience } = baseOpts(params);
  logger.info(`HTTP ${method}, ${url}, params: ${logFriendlyParams(params)}`);

  let authHeaders;
  if (audience) {
    authHeaders = await gcpAuthHeaders(audience);
  }

  const opts = {
    method,
    params: { ...params.qs, ...params.query },
    headers: buildHeaders(params, { ...(params.headers ?? {}), ...authHeaders }),
    validateStatus: function () {
      return true; // do not let axios validate status, we do that ourselves
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  };

  if (params.body) {
    opts.data = params.body;
  }
  if (params.timeout) {
    opts.timeout = params.timeout;
  }
  if (params.responseType) {
    opts.responseType = params.responseType;
  }

  let response;
  try {
    response = await axios(url, opts);
    logger.info(`HTTP response for ${method} ${url}, ${response.status}, ${logFriendlyBody(response.data)}`);
  } catch (err) {
    logger.warn(
      `HTTP ${method}:${url} yielded ${response && response.status}, error: ${err}, body: ${response && response.data}`
    );
    throw err;
  }

  // for backwards compability
  response.statusCode = response.status;
  response.body = response.data;
  return response;
}

function baseOpts(params) {
  if (params.baseUrl) return { url: `${params.baseUrl}${params.path}`, audience: params.audience };

  const application = params.path.split("/").find(Boolean);

  if (!config.livesInGcp?.includes(application)) {
    assert(config.proxyUrl, "proxyUrl config is missing");

    return { url: `${config.proxyUrl}${params.path}` };
  }

  assert(config.gcpProxy, "gcpProxy config is missing");

  return { url: `${config.gcpProxy.url}${params.path}`, audience: config.gcpProxy.audience };
}

function buildHeaders(params, headers = {}) {
  const defaults = {
    accept: "application/json",
    "x-debug-meta-requester-name": config.appName,
  };
  if (params.correlationId) {
    defaults["x-correlation-id"] = params.correlationId;
  }
  if (config.setXThrottle) {
    defaults["x-throttle"] = "yes";
  }
  return { ...defaults, ...headers };
}

function buildVerboseError(method, params, response) {
  const url = response?.config?.url;
  const msg = util.format(
    "HTTP %s:%s yielded %s (detail:",
    method,
    url,
    response && response.statusCode,
    dumpResponse(response),
    ")"
  );
  const error = new Error(msg);
  error.statusCode = response.statusCode;

  return error;
}

function dumpResponse(response) {
  const body = (response && response.body && JSON.stringify(response.body)) || response.text;
  return `${response.statusCode}:${body}`;
}

function buildBackends() {
  const result = { del: performRequest.bind(null, "DELETE") };

  [ "HEAD", "GET", "PATCH", "POST", "PUT" ].forEach((method) => {
    result[method.toLowerCase()] = performRequest.bind(null, method);
  });

  result.asserted = Object.keys(result).reduce((asserted, verb) => {
    asserted[verb] = withAssertion.bind(withAssertion, verb, result[verb]);
    return asserted;
  }, {});

  return result;
}

function withAssertion(verb, fn, params) {
  return fn(params).then((response) => {
    if (verb === "GET" && response.statusCode > 299) {
      throw buildVerboseError("GET", params, response);
    } else if (![ 200, 201, 202, 204, 301, 302 ].includes(response.statusCode)) {
      throw buildVerboseError(verb.toUpperCase(), params, response);
    }

    return response.body;
  });
}

async function gcpAuthHeaders(audience) {
  // this should ONLY be set to true if running locally
  if (config.unauthenticatedHttp) {
    return {};
  }
  const client = await auth.getIdTokenClient(audience);
  return await client.getRequestHeaders();
}

function logFriendlyParams(params) {
  return JSON.stringify({ ...params, body: logFriendlyBody(params.body) });
}

function logFriendlyBody(body) {
  if (!body) return;
  if (body.readable) return "streamed";
  const s = JSON.stringify(body);
  return s.substring(0, 4000);
}

export default buildBackends();
