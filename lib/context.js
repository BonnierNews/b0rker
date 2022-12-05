import assert from "assert";
import httpClient from "./http-client.js";
import buildLogger from "./logger.js";
import {findAttribute, findOrReject} from "./find-attributes.js";

export default function buildContext(correlationId, key) {
  const http = httpClient(correlationId, key);
  const logger = buildLogger(correlationId, key);
  return {
    retryIf,
    rejectIf,
    rejectUnless,
    http,
    logger,
    findAttribute,
    findOrReject: findOrReject.bind(findOrReject, rejectUnless)
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
