import Firestore from "@google-cloud/firestore";
import buildLogger from "../logger.js";

const db = new Firestore();

// We store a parent and all child jobs to be started.
async function storeParent(parentCorrelationId, children, message, nextKey) {
  await db.collection("processed").doc(parentCorrelationId).create({
    startedJobs: children,
    completedJobs: [],
    nextKey,
    message
  });
}

// When a child is completed we add the correlation id to the child and checks if all the children are done.
async function completedChild(child) {
  const {correlationId, parentCorrelationId} = child;
  const logger = buildLogger(child.correlationId, child.key);
  const processedRef = db.collection("processed").doc(parentCorrelationId);
  try {
    const res = await db.runTransaction(async (t) => {
      const doc = await t.get(processedRef);
      const data = doc.data();
      const completedJobs = [...new Set([...data.completedJobs, correlationId])];
      await t.update(processedRef, {completedJobs: completedJobs});
      return [completedJobs.length === data.startedJobs.length, data];
    });
    return res;
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

export {storeParent, completedChild};
