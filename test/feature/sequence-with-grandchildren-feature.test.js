import { fakePubSub, fakeGcpAuth } from "@bonniernews/lu-test";
import nock from "nock";

import { start, route } from "../../index.js";
import jobStorage from "../../lib/job-storage/index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

const grandchildMessages = (childNumber, granchildCorrelationIds) => {
  const childCorrelationId = `abc123:${childNumber - 1}`;
  const parentCorrelationId = `sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:${childCorrelationId}`;
  const childId = `child-${childNumber}`;
  return [
    {
      id: childId,
      key: "sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step",
      correlationId: childCorrelationId,
      parentCorrelationId: undefined,
    },
    {
      id: "grandchild-1",
      key: "trigger.sub-sequence.test-subseq",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-1",
      key: "sub-sequence.test-subseq.perform.something-in-child",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-1",
      key: "sub-sequence.test-subseq.processed",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-2",
      key: "trigger.sub-sequence.test-subseq",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: "grandchild-2",
      key: "sub-sequence.test-subseq.perform.something-in-child",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: "grandchild-2",
      key: "sub-sequence.test-subseq.processed",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: childId,
      key: "sequence.test-seq2.processed",
      correlationId: childCorrelationId,
      parentCorrelationId: undefined,
    },
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

    for (let index = 0; index < 2; index++) {
      const childName = index === 0 ? "first" : "second";
      const childCorrelationId = `abc123:${index}`;
      const childsParentCorrelationId = `sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:${index}`;

      And(`the ${childName} child sequence should have been fulfilled`, () => {
        const childSequence = fakePubSub
          .recordedMessages()
          .filter(
            (m) =>
              m.attributes.correlationId === childCorrelationId ||
              m.attributes.parentCorrelationId === childsParentCorrelationId
          );
        const grandchildCorrelationIds = [
          ...new Set(
            childSequence
              .filter(
                (m) =>
                  m.attributes.parentCorrelationId === childsParentCorrelationId
              )
              .map(({ attributes: { correlationId } }) => correlationId)
          ),
        ];

        childSequence
          .map(({ message: { id }, attributes: { key, correlationId, parentCorrelationId } }) => ({
            id,
            key,
            correlationId,
            parentCorrelationId,
          }))
          .should.eql(grandchildMessages(index + 1, grandchildCorrelationIds));
      });

      And(`the children of the ${childName} sequence should have been added to the database and been completed`, () => {
        jobStorage.getDB()[childsParentCorrelationId].completedJobsCount.should.eql(2);
      });

      And(`the ${childName} sequence process data should be saved in DB`, () => {
        jobStorage.getDB()[childsParentCorrelationId].message.should.eql({
          id: `child-${index + 1}`,
          data: [],
        });
      });

    }
  });
});
