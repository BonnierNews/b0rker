import Firestore from "@google-cloud/firestore";

import { scanForUndefinedKeys, bucketHash } from "./utils/job-storage-helper.js";
import buildLogger from "../logger.js";

const db = new Firestore();

// We store a parent and all child jobs to be started.
async function storeParent(parentCorrelationId, children, message, nextKey) {
  const logger = buildLogger(parentCorrelationId, "storeParent");
  logger.info(
    `Storing parent ${parentCorrelationId} with children ${JSON.stringify(children)} from message ${JSON.stringify(
      message
    )}`
  );
  scanForUndefinedKeys(message);
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
  logger.info(`Completing child ${correlationId} for parent ${parentCorrelationId} on ${key}`);

  const bucket = bucketHash(correlationId);
  logger.info(`Got bucket hash: ${bucket}`);
  let bucketRef;
  let newBucket = false;
  try {
    bucketRef = await db.collection(parentCorrelationId).doc(bucket);
  } catch (error) {
    logger.error(`Error getting bucketRef: ${JSON.stringify(error)}`);
    bucketRef = await db
      .collection(parentCorrelationId)
      .doc(bucket)
      .create({ completedJobs: [ correlationId ] });
    newBucket = true;
  }
  logger.info(`Got bucket ref: ${bucketRef}`);

  try {
    const res = await db.runTransaction(async (t) => {
      if (!newBucket) {
        const bucketDoc = await t.get(bucketRef);
        const bucketData = bucketDoc.data();

        // update the completed jobs for this bucket
        const oldCompletedJobs = bucketData.completedJobs;
        const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
        logger.info(`Updating bucket with new completed jobs: ${JSON.stringify(newCompletedJobs)}`);
        t.update(bucketRef, { completedJobs: newCompletedJobs });
      }

      const { allChildrenComplete, completedJobs } = completedCheck(parentCorrelationId);
      logger.info(`Completed ${completedJobs.length} jobs`);
      const processedRef = await db.collection("processed").doc(parentCorrelationId);
      const doc = await t.get(processedRef);
      const data = doc.data();
      if (allChildrenComplete) await t.update(processedRef, { completedJobs });

      return [ allChildrenComplete, data, completedJobs.length ];
    });
    return res;
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}

async function completedCheck(parentCorrelationId, correlationId) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  const querySnapshot = await db.collection(parentCorrelationId).get();
  const documents = querySnapshot.docs;

  let completedJobs = [ correlationId ]; // because we're in a transaction, the current correlationId won't be there on read
  for (const doc of documents) {
    completedJobs = [ ...new Set([ ...doc.get("completedJobs"), ...completedJobs ]) ];
  }
  return {
    allChildrenComplete: completedJobs.length === db.processed[parentCorrelationId].startedJobs.length,
    completedJobs,
  };
}

export { storeParent, completedChild };
