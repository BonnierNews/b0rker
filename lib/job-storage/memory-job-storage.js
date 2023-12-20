// we try and copy the functionality of firestore here as best we can
import buildLogger from "../logger.js";
import { bucketHash, parentPayload, scanForInvalidKeys } from "./utils/job-storage-helper.js";

let db = { processed: {} };
const maxConcurrentRequests = 5;

function storeParent(parentCorrelationId, children, message, nextKey) {
  const logger = buildLogger(parentCorrelationId, "storeParent");
  logger.info(`Storing parent ${parentCorrelationId} with ${children?.length} children`);
  scanForInvalidKeys(message);
  db.processed[parentCorrelationId] = parentPayload(message, nextKey, children, "memory");
}

function completedChild({ correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  try {
    if (!db[parentCorrelationId]) db[parentCorrelationId] = {};

    const bucket = bucketHash(correlationId);
    if (!db[parentCorrelationId][bucket]) {
      db[parentCorrelationId][bucket] = { completedJobs: [], concurrentRequests: 0 };
    }

    if (++db[parentCorrelationId][bucket].concurrentRequests >= maxConcurrentRequests) {
      throw Error("Too much contention on these documents. Please try again.");
    }
    // update the completed jobs for this bucket
    const oldCompletedJobs = db[parentCorrelationId][bucket].completedJobs;
    const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
    db[parentCorrelationId][bucket].completedJobs = newCompletedJobs;
    return;
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

function parentIsComplete({ parentCorrelationId, key, siblingCount }) {
  const logger = buildLogger(parentCorrelationId, key);
  try {
    const completedJobs = completedCheck(parentCorrelationId);
    logger.info(
      `Have currently completed ${completedJobs?.length} of ${siblingCount} jobs for parent ${parentCorrelationId} on ${key}`
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
    logger.error(`Parent is complete failed ${e}`);
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
  const logger = buildLogger(parentCorrelationId, "removeParent");
  logger.info(`Removing parent ${parentCorrelationId}`);
  // we don't delete anything in the memory store, since we want the data to be available for testing
  return;
}

function getDB(section = "processed") {
  return db[section];
}

function clearDB() {
  db = { processed: {} };
}

export { storeParent, completedChild, parentIsComplete, removeParent, getDB, clearDB };
