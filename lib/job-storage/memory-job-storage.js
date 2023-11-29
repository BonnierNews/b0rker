import buildLogger from "../logger.js";
import { scanForUndefinedKeys, bucketHash } from "./utils/firestore-helper.js";

let db = { processed: {} };
const maxConcurrentRequests = 5;

function storeParent(parentCorrelationId, children, message, nextKey) {
  scanForUndefinedKeys(message);
  db.processed[parentCorrelationId] = {
    startedJobs: children,
    completedJobs: [],
    message,
    nextKey,
    concurrentRequests: 0,
  };
}

function completedChild(child, { correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  try {
    if (!db[parentCorrelationId]) db[parentCorrelationId] = { };

    const bucket = bucketHash(correlationId);
    if (!db[parentCorrelationId][bucket]) db[parentCorrelationId][bucket] = { completedJobs: [], concurrentRequests: 0 };

    if (++db[parentCorrelationId][bucket].concurrentRequests >= maxConcurrentRequests) {
      throw Error("Too much contention on these documents. Please try again.");
    }
    // update the completed jobs for this bucket
    const oldCompletedJobs = db[parentCorrelationId][bucket].completedJobs;
    const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
    db[parentCorrelationId][bucket].completedJobs = newCompletedJobs;

    const { allChildrenComplete, completedJobs } = completedCheck(parentCorrelationId);
    if (allChildrenComplete) db.processed[parentCorrelationId].completedJobs = completedJobs;
    return [ allChildrenComplete, db.processed[parentCorrelationId], completedJobs.length ];
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

function completedCheck(parentCorrelationId) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  // attempt to copy as best we can how it works in firestore
  const querySnapshot = db[parentCorrelationId];
  const documents = Object.keys(querySnapshot);

  const completedJobs = [ ];
  for (const doc of documents) {
    completedJobs.push(...db[parentCorrelationId][doc].completedJobs);
  }
  return {
    allChildrenComplete: completedJobs.length === db.processed[parentCorrelationId].startedJobs.length,
    completedJobs,
  };
}

function getDB(section = "processed") {
  return db[section];
}

function clearDB() {
  db = { processed: {} };
}

export { storeParent, completedChild, getDB, clearDB };
