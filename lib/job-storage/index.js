import config from "exp-config";

const { jobStorage } = config;

async function resolveStorage() {
  if (jobStorage === "firestore") {
    return await import("./firestore-job-storage.js");
  } else if (jobStorage === "memory") {
    return await import("./memory-job-storage.js");
  }
  throw Error("No correct jobStorage selected");
}

export default await resolveStorage();
