import Firestore from "@google-cloud/firestore";

import buildLogger from "../logger.js";

const db = new Firestore();

// We store a parent and all child jobs to be started.
async function storeParent(parentCorrelationId, children, message, nextKey) {
  const logger = buildLogger(parentCorrelationId, "storeParent");
  logger.debug(`Storing parent ${parentCorrelationId} with children ${JSON.stringify(children)} from message ${JSON.stringify(message)}`);
  await db.collection("processed").doc(parentCorrelationId).create({
    startedJobs: children,
    completedJobs: [],
    nextKey,
    message,
  });
}

// When a child is completed we add the correlation id to the child and checks if all the children are done.
async function completedChild(child, { correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  const processedRef = db.collection("processed").doc(parentCorrelationId);
  logger.debug(`Completing child ${correlationId} for parent ${parentCorrelationId} on ${key}`);
  try {
    const res = await db.runTransaction(async (t) => {
      const doc = await t.get(processedRef);
      const data = doc.data();
      logger.debug(`Got data: ${JSON.stringify(data)}`);
      const completedJobs = [ ...new Set([ ...data.completedJobs, correlationId ]) ];
      await t.update(processedRef, { completedJobs });
      logger.debug(`Have completed ${completedJobs.length} of ${data.startedJobs.length} jobs`);
      return [ completedJobs.length === data.startedJobs.length, data, completedJobs.length ];
    });
    return res;
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

export { storeParent, completedChild };
