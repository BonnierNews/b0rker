let db = {};

function storeParent(parentCorrelationId, children, message, nextKey) {
  db[parentCorrelationId] = {
    startedJobs: children,
    completedJobs: [],
    message,
    nextKey,
  };
}

function completedChild(child, { correlationId, parentCorrelationId }) {
  const completedJobs = db[parentCorrelationId].completedJobs;
  const newCompletedJobs = [ ...new Set([ ...completedJobs, correlationId ]) ];
  db[parentCorrelationId].completedJobs = newCompletedJobs;
  return [ newCompletedJobs.length === db[parentCorrelationId].startedJobs.length, db[parentCorrelationId] ];
}

function getDB() {
  return db;
}

function clearDB() {
  db = {};
}

export { storeParent, completedChild, getDB, clearDB };
