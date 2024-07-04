import { buildTaskName } from "../../lib/utils/cloud-tasks.js";

const queueName = "some-queue";
describe("Cloud Task names", () => {
  // buildTaskName(url, body, queueName, correlationId, resendNumber)
  it("should never generate names longer than 500 characters", () => {
    const body = { foo: "bar" };
    const baseTaskName = "some-name_".repeat(52); // Just this is 520 characters, and more will be added

    const taskName = buildTaskName(`/sequence/some-seq/${baseTaskName}`, body, queueName, "some-id", 0);
    taskName.split("/").pop().length.should.eql(500);
  });

  it("should generate different names for different HTTP bodies with the same correlation ID", () => {
    const body1 = { foo: "bar" };
    const body2 = { foo: "baz" };

    const taskName1 = buildTaskName("/sequence/some-seq/perform.some-action", body1, queueName, "same-id");
    const taskName2 = buildTaskName("/sequence/some-seq/perform.some-action", body2, queueName, "same-id");
    taskName1.should.not.eql(taskName2);
  });

  it("should generate equal names for equal HTTP bodies with the same correlation ID", () => {
    const body = { foo: "bar" };

    const taskName1 = buildTaskName("/sequence/some-seq/perform.some-action", body, { correlationId: "same-id" });
    const taskName2 = buildTaskName("/sequence/some-seq/perform.some-action", body, { correlationId: "same-id" });
    taskName1.should.eql(taskName2);
  });
});
