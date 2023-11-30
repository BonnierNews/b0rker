import config from "exp-config";

const isObject = (value) => {
  return !!(value && typeof value === "object" && !Array.isArray(value));
};

export function scanForInvalidKeys(object = {}) {
  for (const key of Object.keys(object)) {
    if (isObject(object[key])) {
      scanForInvalidKeys(object[key]);
    } else if (object[key] === undefined) {
      // provide a better error than the one we get from firestore if a key has a value of undefined
      throw Error(`Key ${key} with value undefined found in object ${JSON.stringify(object)}. Firestore does not allow undefined values.`);
    } else if (![ "string", "object" ].includes(typeof object[key])) {
      throw Error(`Key ${key} with value ${object[key]} found in object ${JSON.stringify(object)}. Firestore only allows strings.`);
    }
  }
}

/* c8 ignore next branch */
export function bucketHash(correlationId, numHashBuckets = config.jobStorageBuckets || 100) {
  // hash function courtesy of Copilot
  let hash = 0;
  for (let i = 0; i < correlationId.length; i++) {
    const char = correlationId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char; // multiply current hash by 31 and add current character
    hash |= 0; // Convert to 32bit integer
  }
  return (Math.abs(hash) % numHashBuckets).toString();
}
