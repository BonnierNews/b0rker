import Firestore from "@google-cloud/firestore";

import { scanForUndefinedKeys } from "./utils/firestore-helper.js";
import buildLogger from "../logger.js";
/* TODO: SIVA then handle following error:
Error: 10 ABORTED: Too much contention on these documents. Please try again.
    at callErrorFromStatus (/app/node_modules/@grpc/grpc-js/build/src/call.js:31:19)
    at Object.onReceiveStatus (/app/node_modules/@grpc/grpc-js/build/src/client.js:192:76)
    at Object.onReceiveStatus (/app/node_modules/@grpc/grpc-js/build/src/client-interceptors.js:360:141)
    at Object.onReceiveStatus (/app/node_modules/@grpc/grpc-js/build/src/client-interceptors.js:323:181)
    at /app/node_modules/@grpc/grpc-js/build/src/resolving-call.js:94:78
    at processTicksAndRejections (node:internal/process/task_queues:78:11)

    which in turn leads to:
    Complete child failed Error: 10 ABORTED: Aborted due to cross-transaction contention. This occurs when multiple transactions attempt to access the same data, requiring Firestore to abort at least one in order to enforce serializability.
*/
const db = new Firestore();

// We store a parent and all child jobs to be started.
async function storeParent(parentCorrelationId, children, message, nextKey) {
  const logger = buildLogger(parentCorrelationId, "storeParent");
  logger.debug(`Storing parent ${parentCorrelationId} with children ${JSON.stringify(children)} from message ${JSON.stringify(message)}`);
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
  logger.debug(`Completing child ${correlationId} for parent ${parentCorrelationId} on ${key}`);
  const processedRef = db.collection("processed").doc(parentCorrelationId);
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
