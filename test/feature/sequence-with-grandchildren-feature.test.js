import { fakePubSub, fakeGcpAuth } from "@bonniernews/lu-test";
import nock from "nock";

import { start, route } from "../../index.js";
import * as jobStorage from "../../lib/job-storage/firestore-job-storage.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

const grandchildMessages = (childNumber) => {
  return [
    { id: `child-${childNumber}`, key: "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step" },
    { id: "grandchild-1", key: "trigger.sub-sequence.test-subseq" },
    { id: "grandchild-1", key: "sub-sequence.test-subseq.perform.something-in-child" },
    { id: "grandchild-1", key: "sub-sequence.test-subseq.processed" },
    { id: "grandchild-2", key: "trigger.sub-sequence.test-subseq" },
    { id: "grandchild-2", key: "sub-sequence.test-subseq.perform.something-in-child" },
    { id: "grandchild-2", key: "sub-sequence.test-subseq.processed" },
    { id: `child-${childNumber}`, key: "sequence.test-seq2.processed" },
  ];
};

Feature("Grandchild processes", () => {
  beforeEachScenario(() => {
    fakeGcpAuth.authenticated();
    nock.disableNetConnect();
    nock.enableNetConnect(/(localhost|127\.0\.0\.1):\d+/);
  });
  afterEachScenario(() => {
    fakePubSub.reset();
    fakeGcpAuth.reset();
    jobStorage.clearDB();
  });

  Scenario("Sequence starts a sequence that starts a sub-sequence", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.do-something", () => {
                return { type: "something", id: 1 };
              }),
              route(".perform.trigger-create-children-step", () => ({
                type: "trigger",
                key: "sequence.test-seq2",
                messages: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-sequence", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sequence",
            name: "test-seq2",
            sequence: [
              route(".trigger-sub-sequence.create-grandchildren-step", () => ({
                type: "trigger",
                key: "sub-sequence.test-subseq",
                messages: [ { id: "grandchild-1" }, { id: "grandchild-2" } ],
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test-subseq",
            sequence: [
              route(".perform.something-in-child", ({ id }) => ({
                type: `I was here ${id}`,
                id,
              })),
            ],
          },
        ],
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage },
        { key: "trigger.sequence.test", correlationId: "abc123", parentCorrelationId: undefined }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(20);
    });

    And("the triggering sequence should have been fulfilled", () => {
      const triggeredSequence = fakePubSub.recordedMessages().filter((m) => m.attributes.correlationId === "abc123");
      triggeredSequence
        .map(({ attributes: { key } }) => ({ key }))
        .should.eql([
          { key: "sequence.test.perform.do-something" },
          { key: "sequence.test.perform.trigger-create-children-step" },
          { key: "sequence.test.perform.resumed-after-sequence" },
          { key: "sequence.test.processed" },
        ]);
    });

    And("the first child sequence should have been fulfilled", () => {
      const firstChildSequence = fakePubSub
        .recordedMessages()
        .filter(
          (m) =>
            m.attributes.correlationId === "abc123:0" ||
            m.attributes.parentCorrelationId ===
              "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:0"
        );
      firstChildSequence
        .map(({ message: { id }, attributes: { key } }) => ({ id, key }))
        .should.eql(grandchildMessages(1));
    });

    And("the children of the first sequence should have been added to the database and been completed", () => {
      const parentCorrId = "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:0";
      jobStorage.getDB()[parentCorrId].completedJobsCount.should.eql(2);
    });

    And("the first sequence process data should be saved in DB", () => {
      const parentCorrId = "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:0";
      jobStorage.getDB()[parentCorrId].message.should.eql({
        id: "child-1",
        data: [],
      });
    });

    And("the second child sequence should have been fulfilled", () => {
      const secondChildSequence = fakePubSub
        .recordedMessages()
        .filter(
          (m) =>
            m.attributes.correlationId === "abc123:1" ||
            m.attributes.parentCorrelationId ===
              "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:1"
        );
      secondChildSequence
        .map(({ message: { id }, attributes: { key } }) => ({ id, key }))
        .should.eql(grandchildMessages(2));
    });

    And("the children of the second sequence should have been added to the database and been completed", () => {
      const parentCorrId = "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:1";
      jobStorage.getDB()[parentCorrId].completedJobsCount.should.eql(2);
    });

    And("the second sequence process data should be saved in DB", () => {
      const parentCorrId = "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:1";
      jobStorage.getDB()[parentCorrId].message.should.eql({
        id: "child-2",
        data: [],
      });
    });
  });
});
