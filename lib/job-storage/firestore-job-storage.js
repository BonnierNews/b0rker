import Firestore from "@google-cloud/firestore";

import { scanForInvalidKeys, bucketHash } from "./utils/job-storage-helper.js";
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
  scanForInvalidKeys(message);
  await db.collection("processed").doc(parentCorrelationId).create({
    startedJobs: children,
    completedJobs: [],
    nextKey,
    message,
  });
}

// When a child is completed we add the correlation id to the child
// we use a bunch of hash buckets to avoid contention on the parent document
async function completedChild({ correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  logger.info(`Completing child ${correlationId} for parent ${parentCorrelationId} on ${key}`);

  const bucket = bucketHash(correlationId);
  const bucketRef = await db.collection(parentCorrelationId).doc(bucket);

  try {
    const res = await db.runTransaction(async (t) => {
      // update the bucket with the new completed job
      const bucketDoc = await t.get(bucketRef);
      const bucketData = bucketDoc.data();

      if (!bucketData) {
        // first time we've seen this bucket, so create it
        t.set(bucketRef, { completedJobs: [ correlationId ] });
      } else {
        // otherwise update the completed jobs for this bucket
        const oldCompletedJobs = bucketData?.completedJobs || [];
        const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
        t.update(bucketRef, { completedJobs: newCompletedJobs });
      }
      return;
    });
    return res;
  } catch (e) {
    logger.error(`Complete child failed ${e}`);
    throw e;
  }
}
// TODO: SIVA cleanup logging
async function parentIsComplete({ parentCorrelationId, key, siblingCount }) {
  const logger = buildLogger(parentCorrelationId, key);
  logger.info(`Checking if parent ${parentCorrelationId} is complete on ${key} with ${siblingCount} children`);

  try {
    // first we'll check if we're done
    const completedJobs = await completedCheck(parentCorrelationId, logger);
    logger.info(`Have currently completed ${completedJobs?.length} of ${siblingCount} jobs`);

    const allChildrenComplete = completedJobs?.length === Number(siblingCount);
    logger.info(`All children complete: ${allChildrenComplete}`);

    // and if we are then we'll return the parent data along with the completed jobs
    let parentData;
    if (allChildrenComplete) {
      // get the current processed doc first (need it be able to return the data)
      const doc = await db.collection("processed").doc(parentCorrelationId).get();
      parentData = doc.data();
    }
    return { isLast: allChildrenComplete, parentData: { ...parentData, completedJobs }, completedJobCount: completedJobs?.length };
  } catch (e) {
    logger.error(`Parent is complete failed ${e}`);
    throw e;
  }
}

async function completedCheck(parentCorrelationId, logger) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  const querySnapshot = await db.collection(parentCorrelationId).get();

  let completedJobs = [ ];
  for (const doc of querySnapshot.docs) {
    const theseCompletedJobs = doc.get("completedJobs");
    completedJobs = [ ...new Set([ ...theseCompletedJobs, ...completedJobs ]) ];
  }
  logger.info(`Currently have ${completedJobs?.length} completed jobs`);
  return completedJobs;
}

export { storeParent, completedChild, parentIsComplete };
