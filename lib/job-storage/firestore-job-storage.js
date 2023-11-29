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
// we use a bunch of hash buckets to avoid contention on the parent document
async function completedChild({ correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
  logger.info(`Completing child ${correlationId} for parent ${parentCorrelationId} on ${key}`);

  const bucket = bucketHash(correlationId);
  logger.info(`Got bucket hash: ${bucket}`);
  const bucketRef = await db.collection(parentCorrelationId).doc(bucket);

  logger.info(`Got bucket ref: ${JSON.stringify(bucketRef)}`);

  try {
    const res = await db.runTransaction(async (t) => {
      // update the bucket with the new completed job
      const bucketDoc = await t.get(bucketRef);
      const bucketData = bucketDoc.data();
      logger.info(`Got bucket data: ${JSON.stringify(bucketData)}`);

      if (!bucketData) {
        // first time we've seen this bucket, so create it
        t.set(bucketRef, { completedJobs: [ correlationId ] });
      } else {
        // otherwise update the completed jobs for this bucket
        const oldCompletedJobs = bucketData?.completedJobs || [];
        const newCompletedJobs = [ ...new Set([ ...oldCompletedJobs, correlationId ]) ];
        logger.info(`Updating bucket with new completed jobs: ${JSON.stringify(newCompletedJobs)}`);

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

async function parentIsComplete({ parentCorrelationId, key, siblingCount }) {
  const logger = buildLogger(parentCorrelationId, key);
  logger.info(`Checking is parent ${parentCorrelationId} is complete on ${key}`);
  logger.info(`Expecting ${siblingCount} children`);

  try {
    // first we'll check if we're done
    const { completedJobs } = completedCheck(parentCorrelationId, logger);
    logger.info(`Completed ${completedJobs?.length} jobs`);

    const allChildrenComplete = completedJobs?.length === siblingCount;
    logger.info(`All children complete: ${allChildrenComplete}`);

    // and if we are then we'll return the parent data along with the completed jobs
    let parentData;
    if (allChildrenComplete) {
      // get the current processed doc first (need it be able to return the data)
      const doc = await db.collection("processed").doc(parentCorrelationId).get();
      parentData = doc.data();
    }
    return [ allChildrenComplete, { ...parentData, completedJobs }, completedJobs?.length ];
  } catch (e) {
    logger.error(`Parent is complete failed ${e}`);
    throw e;
  }
}

async function completedCheck(parentCorrelationId, logger) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  const querySnapshot = await db.collection(parentCorrelationId).get();
  const documents = querySnapshot.docs;
  logger.info(`Got ${documents?.length} documents`);
  let completedJobs = [ ];
  for (const doc of documents) {
    const theseCompletedJobs = doc.get("completedJobs");
    logger.info(`Got ${theseCompletedJobs?.length} completed jobs from doc ${JSON.stringify(doc.id)}`);
    completedJobs = [ ...new Set([ ...theseCompletedJobs, ...completedJobs ]) ];
  }
  logger.info(`Current completed jobs: ${completedJobs?.length}`);
  return { completedJobs };
}

export { storeParent, completedChild, parentIsComplete };
