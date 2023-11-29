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
