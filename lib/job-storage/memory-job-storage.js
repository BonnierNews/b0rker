import buildLogger from "../logger.js";
import { scanForUndefinedKeys } from "./utils/firestore-helper.js";

let db = { processed: {}, buckets: {} };

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
  db = { processed: {}, buckets: {} };
}

export { storeParent, completedChild, getDB, clearDB };
