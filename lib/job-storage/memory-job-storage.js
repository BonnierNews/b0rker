import buildLogger from "../logger.js";

let db = {};

function storeParent(parentCorrelationId, children, message, nextKey) {
  db[parentCorrelationId] = {
    startedJobs: children,
    completedJobs: [],
    message,
    nextKey,
  };
}

function completedChild(child, { correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  try {
    const completedJobs = db[parentCorrelationId].completedJobs;
    const newCompletedJobs = [ ...new Set([ ...completedJobs, correlationId ]) ];
    db[parentCorrelationId].completedJobs = newCompletedJobs;
    return [ newCompletedJobs.length === db[parentCorrelationId].startedJobs.length, db[parentCorrelationId] ];
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

function getDB() {
  return db;
}

function clearDB() {
  db = {};
}

export { storeParent, completedChild, getDB, clearDB };
