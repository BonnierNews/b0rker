import assert from "assert";
import { logger } from "lu-logger";

import http from "./http.js";
import { findAttribute, findOrReject } from "./find-attributes.js";

export default function buildContext(key) {
  return {
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
  if (typeof predicate === "function") {
    return retryIf(predicate(), message);
  }
  try {
    assert(!predicate, message);
  } catch (err) {
    err.retry = true;
    throw err;
  }
}

function rejectIf(predicate, message) {
  if (typeof predicate === "function") {
    return rejectIf(predicate(), message);
  }
  try {
    assert(!predicate, message);
  } catch (err) {
    err.rejected = true;
    err.extraMessage = message;
    throw err;
  }
}

function rejectUnless(predicate, message) {
  if (typeof predicate === "function") {
    return rejectUnless(predicate(), message);
  }
  try {
    assert(predicate, message);
  } catch (err) {
    err.rejected = true;
    err.extraMessage = message;
    throw err;
  }
}

function retryUnless(predicate, message) {
  if (typeof predicate === "function") {
    return retryUnless(predicate(), message);
  }
  try {
    assert(predicate, message);
  } catch (err) {
    err.retry = true;
    throw err;
  }
}

function unrecoverableIf(predicate, message) {
  if (typeof predicate === "function") {
    return unrecoverableIf(predicate(), message);
  }
  try {
    assert(!predicate, message);
  } catch (err) {
    err.unrecoverable = true;
    err.extraMessage = message;
    throw err;
  }
}

function unrecoverableUnless(predicate, message) {
  if (typeof predicate === "function") {
    return unrecoverableUnless(predicate(), message);
  }
  try {
    assert(predicate, message);
  } catch (err) {
    err.unrecoverable = true;
    err.extraMessage = message;
    throw err;
  }
}
