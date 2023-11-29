import config from "exp-config";

const numHashBuckets = config.jobStorageBuckets || 100;

const isObject = (value) => {
  return !!(value && typeof value === "object" && !Array.isArray(value));
};

export function scanForUndefinedKeys(object = {}) {
  for (const key of Object.keys(object)) {
    if (isObject(object[key])) {
      scanForUndefinedKeys(object[key]);
    } else if (object[key] === undefined) {
      // provide a better error than the one we get from firestore if a key has a value of undefined
      throw Error(`Key ${key} with value undefined found in object ${JSON.stringify(object)}. Firestore does not allow undefined values.`);
    }
  }
}

export function bucketHash(correlationId) {
  // hash function courtesy of Copilot
  let hash = 0;
  for (let i = 0; i < correlationId.length; i++) {
    const char = correlationId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char; // multiply current hash by 31 and add current character
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % numHashBuckets;
}
