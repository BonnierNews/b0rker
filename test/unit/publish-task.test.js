import { fakeCloudTasks } from "@bonniernews/lu-test";
import express from "express";

import { publishTask } from "../../lib/publish-task.js";

describe("Cloud Task names", () => {
  const broker = express();

  beforeEach(() => fakeCloudTasks.enablePublish(broker));
  afterEach(fakeCloudTasks.reset);

  it("should never generate names longer than 500 characters", async () => {
    const body = { foo: "bar" };
    const taskName = "some-name_".repeat(52); // Just this is 520 characters, and more will be added

    await publishTask(`/sequence/some-seq/${taskName}`, body, { correlationId: "some-id" });
    await fakeCloudTasks.processMessages();

    const messages = fakeCloudTasks.recordedMessages();
    messages.length.should.eql(1);
    messages[0].taskName.split("/").pop().length.should.eql(500);
  });

  it("should generate different names for different HTTP bodies with the same correlation ID", async () => {
    const body1 = { foo: "bar" };
    const body2 = { foo: "baz" };

    await publishTask("/sequence/some-seq/perform.some-action", body1, { correlationId: "same-id" });
    await publishTask("/sequence/some-seq/perform.some-action", body2, { correlationId: "same-id" });

    await fakeCloudTasks.processMessages();

    const messages = fakeCloudTasks.recordedMessages();
    messages.length.should.eql(2);
    messages[0].taskName.should.not.eql(messages[1].taskName);
  });

  it("should generate equal names for equal HTTP bodies with the same correlation ID", async () => {
    const body = { foo: "bar" };

    await publishTask("/sequence/some-seq/perform.some-action", body, { correlationId: "same-id" });
    await publishTask("/sequence/some-seq/perform.some-action", body, { correlationId: "same-id" });

    await fakeCloudTasks.processMessages();

    const messages = fakeCloudTasks.recordedMessages();
    messages.length.should.eql(2);
    messages[0].taskName.should.eql(messages[1].taskName);
  });
});
