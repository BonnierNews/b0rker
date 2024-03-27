import assert from "assert";

import httpClient from "./http-client.js";
import buildLogger from "./logger.js";
import { findAttribute, findOrReject } from "./find-attributes.js";

export default function buildContext(correlationId, key) {
  const http = httpClient(correlationId, key);
  const logger = buildLogger(correlationId, key);
  return {
    correlationId,
    retryIf,
    rejectIf,
    unrecoverableIf,
    rejectUnless,
    retryUnless,
    unrecoverableUnless,
    http,
    logger,
    findAttribute,
    findOrReject: findOrReject.bind(findOrReject, rejectUnless),
    key,
  };
}

function retryIf(predicate, message) {
  try {
    assert(!predicate, message);
  } catch (err) {
    err.retry = true;
    throw err;
  }
}

function rejectIf(predicate, message) {
  try {
    assert(!predicate, message);
  } catch (err) {
    err.rejected = true;
    err.extraMessage = message;
    throw err;
  }
}

function rejectUnless(predicate, message) {
  try {
    assert(predicate, message);
  } catch (err) {
    err.rejected = true;
    err.extraMessage = message;
    throw err;
  }
}

function retryUnless(predicate, message) {
  try {
    assert(predicate, message);
  } catch (err) {
    err.retry = true;
    throw err;
  }
}

function unrecoverableIf(predicate, message) {
  try {
    assert(!predicate, message);
  } catch (err) {
    err.unrecoverable = true;
    err.extraMessage = message;
    throw err;
  }
}

function unrecoverableUnless(predicate, message) {
  try {
    assert(predicate, message);
  } catch (err) {
    err.unrecoverable = true;
    err.extraMessage = message;
    throw err;
  }
}
