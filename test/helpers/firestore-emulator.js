import config from "exp-config";
import assert from "assert";
import axios from "axios";
import { createSandbox } from "sinon";
import { Transaction } from "@google-cloud/firestore";

export async function clearDb() {
  assert(process.env.NODE_ENV === "test" && config?.firestore, "Only run this in tests with firestore config");
  const { host, projectId } = config.firestore;
  await axios.delete(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`);
}

const sandbox = createSandbox();
let stub;

export function preventFirestoreDeletions() {
  if (!stub) {
    stub = sandbox.stub(Transaction.prototype, "delete");
    stub.callsFake((doc) => {
      console.log(`Prevented firestore deletion of doc ${doc.path}`);
    });
  }
}

export function restoreFirestoreDeletions() {
  sandbox.restore();
  stub = null;
}
