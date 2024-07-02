import * as sinon from "sinon";

import withRetries from "../../lib/utils/retry.js";

describe("Retry", () => {
  it("should not do anything if the function succeeds", async () => {
    const testFunc = sinon.spy(() => "success");
    const result = await withRetries(testFunc, { maxRetries: 3, initialDelay: 0 });

    result.should.eql("success");
    testFunc.callCount.should.eql(1);
  });

  it("should throw the exception after max retries", async () => {
    const error = new Error("Test error");
    const testFunc = sinon.spy(() => {
      throw error;
    });

    try {
      await withRetries(testFunc, { maxRetries: 3, initialDelay: 0 });
    } catch (e) {
      e.should.eql(error);
    }

    testFunc.callCount.should.eql(4);
  });

  it("should not throw if the function succeeds", async () => {
    const error = new Error("Test error");
    let attempts = 0;
    const testFunc = sinon.spy(() => {
      attempts++;
      if (attempts < 3) throw error;
      return "success";
    });

    const result = await withRetries(testFunc, { maxRetries: 3, initialDelay: 0 });

    result.should.eql("success");
    testFunc.callCount.should.eql(3);
  });
});
