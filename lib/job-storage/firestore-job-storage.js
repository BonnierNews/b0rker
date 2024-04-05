import { Firestore } from "@google-cloud/firestore";

import { bucketHash, parentPayload, scanForInvalidKeys } from "./utils/job-storage-helper.js";
import buildLogger from "../logger.js";

const db = new Firestore();

// We store a parent and all child jobs to be started.
async function storeParent(parentCorrelationId, children, message, nextKey) {
  const logger = buildLogger(parentCorrelationId, "storeParent");
  logger.info(`Storing parent ${parentCorrelationId} with ${children?.length} children`);
  scanForInvalidKeys(message);
  await db
    .collection("processed")
    .doc(parentCorrelationId)
    .create(parentPayload(message, nextKey, children, "firestore"));
}

// When a child is completed we add the correlation id to the child
// we use a bunch of hash buckets to avoid contention on the parent document
async function completedChild({ correlationId, parentCorrelationId, key }) {
  const logger = buildLogger(correlationId, key);
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

async function parentIsComplete({ parentCorrelationId, key, siblingCount }) {
  const originalCorrelationId = parentCorrelationId.split(":").slice(1).join(":");
  const logger = buildLogger(originalCorrelationId, key);
  try {
    // first we'll check if we're done
    const completedJobs = await completedCheck(parentCorrelationId);
    logger.info(
      `Have currently completed ${completedJobs?.length} of ${siblingCount} jobs for parent ${parentCorrelationId} on ${key}`
    );
    const allChildrenComplete = completedJobs?.length === Number(siblingCount);

    // and if we are then we'll return the parent data along with the completed jobs
    let parentData;
    if (allChildrenComplete) {
      // get the current processed doc (need it be able to return the data)
      const doc = await db.collection("processed").doc(parentCorrelationId).get();
      parentData = doc.data();
    }
    return { isLast: allChildrenComplete, parentData, completedJobCount: completedJobs?.length };
  } catch (e) {
    logger.error(`Parent is complete failed ${e}`);
    throw e;
  }
}

async function completedCheck(parentCorrelationId) {
  // scan through all the buckets for our parentCorrelationId and see if all the children are complete
  const querySnapshot = await db.collection(parentCorrelationId).get();

  const completedJobs = new Set();
  for (const doc of querySnapshot.docs) {
    const theseCompletedJobs = doc.get("completedJobs");
    theseCompletedJobs.forEach((job) => completedJobs.add(job));
  }
  return [ ...completedJobs ];
}

async function removeParent(parentCorrelationId) {
  const originalCorrelationId = parentCorrelationId.split(":").slice(1).join(":");
  const logger = buildLogger(originalCorrelationId, "removeParent");
  try {
    // remove the parent document from the processed collection
    const parentDoc = await db.collection("processed").doc(parentCorrelationId).get();
    if (!parentDoc.exists) {
      logger.warn(`Parent ${parentCorrelationId} not found, it has probably been deleted already. Exiting.`);
      return false;
    }
    await parentDoc.ref.delete();

    // remove all children, in chunks of 100
    const bucketsRef = db.collection(parentCorrelationId);
    const query = bucketsRef.orderBy("__name__").limit(100);

    let snapshot;
    while ((snapshot = await query.get()).size > 0) {
      logger.info(`Removing ${snapshot.size} children for parent ${parentCorrelationId}`);
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
    logger.info(`Removed all children for parent ${parentCorrelationId}`);
    return true;
  } catch (e) {
    logger.error(`Remove parent failed ${e}`);
    throw e;
  }
}

async function messageAlreadySeen(idempotencyKey, deliveryAttempt) {
  try {
    await db
      .collection("idempotencyLocks")
      .doc(`${idempotencyKey}:${deliveryAttempt}`)
      .create({ idempotencyKey, deliveryAttempt, expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    return false;
  } catch (err) {
    if (err.message.startsWith("6 ALREADY_EXISTS") || err.code === "already-exists") {
      return true;
    }
    throw err;
  }
}

export { storeParent, completedChild, parentIsComplete, removeParent, messageAlreadySeen };
