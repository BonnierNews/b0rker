import { fakeCloudTasks, fakeGcpAuth } from "@bonniernews/lu-test";
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
      url: "/v2/sequence/test-seq2",
      correlationId: childCorrelationId,
      parentCorrelationId: undefined,
    },
    {
      id: childId,
      url: "/v2/sequence/test-seq2/trigger-sub-sequence.create-grandchildren-step",
      correlationId: childCorrelationId,
      parentCorrelationId: undefined,
    },
    {
      id: "grandchild-1",
      url: "/v2/sub-sequence/test-subseq",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-2",
      url: "/v2/sub-sequence/test-subseq",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: "grandchild-1",
      url: "/v2/sub-sequence/test-subseq/perform.something-in-child",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-2",
      url: "/v2/sub-sequence/test-subseq/perform.something-in-child",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: "grandchild-1",
      url: "/v2/sub-sequence/test-subseq/processed",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[0],
    },
    {
      id: "grandchild-2",
      url: "/v2/sub-sequence/test-subseq/processed",
      parentCorrelationId,
      correlationId: granchildCorrelationIds[1],
    },
    {
      id: childId,
      url: "/v2/sequence/test-seq2/processed",
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage, { "correlation-id": "abc123" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("all messages including children should have been published", () => {
      response.messages.length.should.eql(22);
    });

    And("the triggering sequence should have been fulfilled", () => {
      const triggeredSequence = response.messages.filter((m) => m.correlationId === "abc123");
      triggeredSequence
        .map(({ url }) => ({ url }))
        .should.eql([
          { url: "/v2/sequence/test/perform.do-something" },
          { url: "/v2/sequence/test/perform.trigger-create-children-step" },
          { url: "/v2/sequence/test/perform.resumed-after-sequence" },
          { url: "/v2/sequence/test/processed" },
        ]);
    });

    for (let index = 0; index < 2; index++) {
      const childName = index === 0 ? "first" : "second";
      const childCorrelationId = `abc123:${index}`;
      const childsParentCorrelationId = `sequence.test-seq2.trigger-sub-sequence.create-grandchildren-step:abc123:${index}`;

      // eslint-disable-next-line no-loop-func
      And(`the ${childName} child sequence should have been fulfilled`, () => {
        const childSequence = response.messages.filter(
          (m) => m.correlationId === childCorrelationId || m.headers.parentCorrelationId === childsParentCorrelationId
        );

        const grandchildCorrelationIds = [
          ...new Set(
            childSequence
              .filter((m) => m.headers.parentCorrelationId === childsParentCorrelationId)
              .map(({ headers: { "correlation-id": correlationId } }) => correlationId)
          ),
        ];

        childSequence
          .map(({ url, message: { id }, headers: { "correlation-id": correlationId, parentCorrelationId } }) => ({
            id,
            url,
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
