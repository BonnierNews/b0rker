import chai from "chai";

export async function assertRejected(fn) {
  try {
    await fn();
  } catch (error) {
    error.should.have.property("rejected");
    error.rejected.should.eql(true);
    return error;
  }
  throw new chai.AssertionError("not rejected");
}

export async function assertRetry(fn) {
  try {
    await fn();
  } catch (error) {
    error.should.not.have.property("rejected");
    return error;
  }
  throw new chai.AssertionError("not retried");
}
