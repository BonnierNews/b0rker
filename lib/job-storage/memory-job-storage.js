// we try and copy the functionality of firestore here as best we can
import { logger } from "lu-logger";

import { bucketHash, parentPayload, scanForInvalidKeys } from "./utils/job-storage-helper.js";

let db = { processed: {}, idempotencyLocks: {} };

function storeParent(parentCorrelationId, children, message, nextKey) {
  logger.info(`Storing parent ${parentCorrelationId} with ${children?.length} children`);
  scanForInvalidKeys(message);
  if (db.processed[parentCorrelationId]) {
    const error = new Error(
      `6 ALREADY_EXISTS: Document already exists: memory/databases/(default)/documents/processed/${parentCorrelationId}`
    );
    error.code = "already-exists";
    throw error;
  }
  db.processed[parentCorrelationId] = parentPayload(message, nextKey, children, "memory");
}

function completedChild({ correlationId, parentCorrelationId }) {
  try {
    if (!db[parentCorrelationId]) db[parentCorrelationId] = {};

    const bucket = bucketHash(correlationId);
    if (!db[parentCorrelationId][bucket]) {
      db[parentCorrelationId][bucket] = { completedJobs: [] };
    }
    // update the completed jobs for this bucket
    const oldCompletedJobs = db[parentCorrelationId][bucket].completedJobs;
    const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
    db[parentCorrelationId][bucket].completedJobs = newCompletedJobs;
    return;
  } catch (e) {
    /* c8 ignore next 3 */
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

function parentIsComplete({ parentCorrelationId, key, siblingCount }) {
  const originalCorrelationId = parentCorrelationId?.split(":").slice(1).join(":");
  try {
    const completedJobs = completedCheck(parentCorrelationId);
    logger.info(
      `Have currently completed ${completedJobs?.length} of ${siblingCount} jobs for parent ${parentCorrelationId} on ${key}`,
      { correlationId: originalCorrelationId }
    );
    const allChildrenComplete = completedJobs?.length === Number(siblingCount);

    // only return parentData if all children are complete, as we do in firestore
    let parentData;
    if (allChildrenComplete) {
      // we only save the number of completedJobs in memory, so it is available in tests
      db.processed[parentCorrelationId].completedJobsCount = completedJobs?.length;
      parentData = db.processed[parentCorrelationId];
    }
    return { isLast: allChildrenComplete, parentData, completedJobCount: completedJobs?.length };
  } catch (e) {
    /* c8 ignore next 3 */
    logger.error(`Parent is complete failed ${e}`, { correlationId: originalCorrelationId });
    throw e;
  }
}

function completedCheck(parentCorrelationId) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  // attempt to copy as best we can how it works in firestore
  const querySnapshot = db[parentCorrelationId];
  const documents = Object.keys(querySnapshot);

  const completedJobs = [];
  for (const doc of documents) {
    completedJobs.push(...db[parentCorrelationId][doc].completedJobs);
  }
  return completedJobs;
}

function removeParent(parentCorrelationId) {
  const originalCorrelationId = parentCorrelationId.split(":").slice(1).join(":");
  logger.info(`Removing parent ${parentCorrelationId}`, { correlationId: originalCorrelationId });
  // we don't delete anything in the memory store, since we want the data to be available for testing
  return true;
}

function messageAlreadySeen(idempotencyKey, deliveryAttempt) {
  if (db.idempotencyLocks[`${idempotencyKey}:${deliveryAttempt}`]) {
    return true;
  }
  db.idempotencyLocks[`${idempotencyKey}:${deliveryAttempt}`] = { idempotencyKey, deliveryAttempt };
  return false;
}

function getDB(section = "processed") {
  return db[section];
}

function clearDB() {
  db = { processed: {}, idempotencyLocks: {} };
}

export { clearDB, completedChild, getDB, messageAlreadySeen, parentIsComplete, removeParent, storeParent };
