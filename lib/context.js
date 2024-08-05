import assert from "assert";
import { logger } from "lu-logger";

import { findAttribute, findOrReject } from "./find-attributes.js";
import httpClient from "./http-client.js";

export default function buildContext(correlationId, key) {
  const http = httpClient(correlationId, key);
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
    err.extraMessage = message;
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
    err.extraMessage = message;
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
