import * as uuid from "uuid";

import { scanForInvalidKeys, bucketHash } from "../../lib/job-storage/utils/job-storage-helper.js";

describe("scanning for invalid (firestore) keys", () => {
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
    for (const { numBuckets, numIds, variance } of [
      { numBuckets: 10, numIds: 1000, variance: 0.5 },
      { numBuckets: 100, numIds: 100000, variance: 0.25 },
      { numBuckets: 1000, numIds: 1000000, variance: 0.25 },
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
        const maxBucketSize = Math.ceil(expectedBucketSize * (1 + variance));
        const minBucketSize = Math.floor(expectedBucketSize * (1 - variance));
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
