import assert from "assert";
import util from "util";

export function findAttribute(collection, typeFilter, attribute = null) {
  collection = collection || [];
  assert(collection.find, util.format("Collection", collection, "does not have a find method"));
  const obj = collection.find(({type}) => type === typeFilter);
  if (attribute === null) return obj;
  if (
    (obj && obj[attribute]) ||
    (obj && typeof obj[attribute] === "number") ||
    (obj && typeof obj[attribute] === "boolean")
  ) {
    return obj[attribute];
  }
  return null;
}

export function findOrReject(rejectUnless, collection, typeFilter, attribute = null) {
  const result = findAttribute(collection, typeFilter, attribute);
  rejectUnless(
    result || typeof result === "number" || typeof result === "boolean",
    `Need ${typeFilter} ${attribute} to proceed`
  );
  return result;
}
