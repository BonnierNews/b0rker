import * as uuid from "uuid";

import { bucketHash, parentPayload, scanForInvalidKeys } from "../../lib/job-storage/utils/job-storage-helper.js";

describe("scanning for invalid (according to firestore) keys", () => {
  it("should throw an error if a key is undefined", () => {
    const message = { id: undefined };
    try {
      scanForInvalidKeys(message);
    } catch (error) {
      error.message.should.eql(
        "Key id with value undefined found in object {}. Firestore does not allow undefined values."
      );
    }
  });
  it("should throw an error if a key is a number", () => {
    const message = { id: "some-id", attributes: { something: 1 } };
    try {
      scanForInvalidKeys(message);
    } catch (error) {
      error.message.should.eql(
        'Key something with value 1 found in object {"something":1}. Firestore only allows strings.'
      );
    }
  });
  it("should not throw an error if all keys are valid", () => {
    const message = { id: "some-id", attributes: { something: "1" } };
    const response = scanForInvalidKeys(message);
    should.not.exist(response);
  });
});

describe("bucket hashing", () => {
  describe("basic tests", () => {
    it("should return a number as a string", () => {
      const hash = bucketHash(uuid.v4());
      (typeof hash).should.eql("string");
      (typeof parseInt(hash)).should.eql("number");
    });
    it("should return a number between 0 and 9", () => {
      const hash = bucketHash(uuid.v4());
      parseInt(hash).should.be.within(0, 9);
    });
    it("should return the same number for the same id", () => {
      const correlationId = uuid.v4();
      const hash1 = bucketHash(correlationId);
      const hash2 = bucketHash(correlationId);
      hash1.should.eql(hash2);
    });
    it("should return different numbers for different ids", () => {
      const hash1 = bucketHash(uuid.v4(), 1000);
      const hash2 = bucketHash(uuid.v4(), 1000);
      hash1.should.not.eql(hash2);
    });
  });
  describe("the hash algorithim is uniform enough", () => {
    // the fewer items per bucket, the more variance we expect
    // since the aim is to avoid contention, it should be fine as long as we get a reasonable distribution
    for (const { numBuckets, numIds, allowedVariance } of [
      { numBuckets: 10, numIds: 1000, allowedVariance: 0.5 }, // few items per bucket so 50% variance is ok
      { numBuckets: 100, numIds: 100000, allowedVariance: 0.25 }, // more items per bucket so 25% variance is ok
      { numBuckets: 1000, numIds: 1000000, allowedVariance: 0.25 }, // lots of items, lots of buckets so 25% variance is ok
    ]) {
      describe(`${numIds} ids split into ${numBuckets} buckets`, () => {
        const ids = Array.from({ length: numIds }, () => uuid.v4());
        const buckets = ids.map((id) => bucketHash(id, numBuckets));
        const bucketCounts = {};
        buckets.forEach((bucket) => {
          if (!bucketCounts[bucket]) bucketCounts[bucket] = 0;
          bucketCounts[bucket]++;
        });
        const expectedBucketSize = numIds / numBuckets;
        // allow +/- variance on the bucket sizes
        const maxBucketSize = Math.ceil(expectedBucketSize * (1 + allowedVariance));
        const minBucketSize = Math.floor(expectedBucketSize * (1 - allowedVariance));
        it(`should only have bucket sizes between ${minBucketSize} and ${maxBucketSize}`, () => {
          const badBucket = Object.keys(bucketCounts).find((bucket) => {
            const bucketSize = bucketCounts[bucket];
            return bucketSize < minBucketSize || bucketSize > maxBucketSize;
          });
          should.not.exist(badBucket);
        });
      });
    }
  });
});

describe("parent payload", () => {
  it("should return the correct payload for firestore", () => {
    const message = { id: "some-id", attributes: { something: "1" } };
    const nextKey = "next-key";
    const children = [ "child-1", "child-2" ];
    const payload = parentPayload(message, nextKey, children);
    payload.should.eql({
      startedJobsCount: 2,
      message,
      nextKey,
    });
  });
  it("should return the correct payload for memory", () => {
    const message = { id: "some-id", attributes: { something: "1" } };
    const nextKey = "next-key";
    const children = [ "child-1", "child-2" ];
    const payload = parentPayload(message, nextKey, children, "memory");
    payload.should.eql({
      startedJobsCount: 2,
      message,
      nextKey,
      concurrentRequests: 0,
      completedJobsCount: 0,
    });
  });
  it("should throw an error if the payload is too big (e.g. if the children are included in the message)", () => {
    const children = Array.from({ length: 100000 }, () => uuid.v4());
    const message = { id: "some-id", attributes: { something: "1", tooMuchData: children } };
    const nextKey = "next-key";
    let payload;
    try {
      payload = parentPayload(message, nextKey, children);
    } catch (error) {
      error.message.should.eql("This message is too big for firestore to handle");
    }
    should.not.exist(payload);
  });
});
