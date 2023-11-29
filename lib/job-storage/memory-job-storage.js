import buildLogger from "../logger.js";
import { scanForUndefinedKeys } from "./utils/firestore-helper.js";

let db = { processed: {}, buckets: {} };
let concurrentRequests = 0;
const maxConcurrentRequests = 5;

function storeParent(parentCorrelationId, children, message, nextKey) {
  scanForUndefinedKeys(message);
  db.processed[parentCorrelationId] = {
    startedJobs: children,
    completedJobs: [],
    message,
    nextKey,
  };
}

function completedChild(child, { correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  try {
    if (++concurrentRequests >= maxConcurrentRequests) {
      throw Error("Too much contention on these documents. Please try again.");
    }
    const completedJobs = db.processed[parentCorrelationId].completedJobs;
    const newCompletedJobs = [ ...new Set([ ...completedJobs, correlationId ]) ];
    db.processed[parentCorrelationId].completedJobs = newCompletedJobs;
    return [
      newCompletedJobs.length === db.processed[parentCorrelationId].startedJobs.length,
      db.processed[parentCorrelationId],
      newCompletedJobs.length,
    ];
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

function getDB(section = "processed") {
  return db[section];
}

function clearDB() {
  concurrentRequests = 0;
  db = { processed: {}, buckets: {} };
}

export { storeParent, completedChild, getDB, clearDB };
