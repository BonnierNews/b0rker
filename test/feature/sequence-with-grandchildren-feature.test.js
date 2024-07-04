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

// FIXME: refactor this to clean it up and make it more readable
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

  Scenario("Sequence starts a sub-sequence that starts another sub-sequence", () => {
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
                key: "sub-sequence.child-subseq",
                messages: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-children", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "child-subseq",
            sequence: [
              route(".trigger-sub-sequence.create-grandchildren-step", () => ({
                type: "trigger",
                key: "sub-sequence.grandchild-subseq",
                messages: [ { id: "grandchild-1" }, { id: "grandchild-2" } ],
              })),
              route(".perform.resumed-after-grandchildren", () => ({
                type: "Grandchildren done",
                id: "goodbye",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "grandchild-subseq",
            sequence: [
              route(".perform.something-in-grandchild", ({ id }) => ({
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

    And("all messages including children and grandchildren should have been published", () => {
      response.messages.length.should.eql(24);
    });

    let childCorrelationIds = new Set();
    And("the triggering sequence should have been fulfilled", () => {
      const triggeredSequence = response.messages.filter((m) => m.correlationId === "abc123");
      triggeredSequence
        .map(({ url }) => ({ url }))
        .should.eql([
          { url: "/v2/sequence/test/perform.do-something" },
          { url: "/v2/sequence/test/perform.trigger-create-children-step" },
          { url: "/v2/sequence/test/perform.resumed-after-children" },
          { url: "/v2/sequence/test/processed" },
        ]);
      response.messages.forEach(({ headers: { correlationId, parentCorrelationId } }) => {
        if (parentCorrelationId?.endsWith("abc123")) {
          childCorrelationIds.add(correlationId);
        }
      });
      childCorrelationIds = [ ...childCorrelationIds ];
    });

    for (let index = 0; index < 2; index++) {
      const childName = index === 0 ? "first" : "second";
      const childNumber = index + 1;
      const childId = `child-${childNumber}`;

      let childCorrelationId;
      let childsParentCorrelationId;
      let childSequence;
      // eslint-disable-next-line no-loop-func
      And(`the ${childName} child sub-sequence should have been fulfilled`, () => {
        childCorrelationId = childCorrelationIds[index];
        childsParentCorrelationId = "sequence.test.perform.trigger-create-children-step:abc123";
        childSequence = response.messages
          .filter(
            (m) =>
              (m.headers.correlationId === childCorrelationId ||
              m.headers.parentCorrelationId === childsParentCorrelationId) && m.message.id === childId
          );
        childSequence
          .map(({ message: { id }, url, headers: { correlationId, parentCorrelationId } }) => ({
            id,
            url,
            correlationId,
            parentCorrelationId,
          }))
          .should.eql([
            {
              id: childId,
              url: "/v2/sub-sequence/child-subseq",
              correlationId: childCorrelationId,
              parentCorrelationId: childsParentCorrelationId,
            },
            {
              id: childId,
              url: "/v2/sub-sequence/child-subseq/trigger-sub-sequence.create-grandchildren-step",
              correlationId: childCorrelationId,
              parentCorrelationId: childsParentCorrelationId,
            },
            {
              id: childId,
              url: "/v2/sub-sequence/child-subseq/perform.resumed-after-grandchildren",
              correlationId: childCorrelationId,
              parentCorrelationId: childsParentCorrelationId,
            },
            {
              id: childId,
              url: "/v2/sub-sequence/child-subseq/processed",
              correlationId: childCorrelationId,
              parentCorrelationId: childsParentCorrelationId,
            },
          ]);
      });

      And(`the children of the ${childName} sub-sequence should have been added to the database and been completed`, () => {
        jobStorage.getDB()[childsParentCorrelationId].completedJobsCount.should.eql(2);
      });

      And(`the ${childName} sub-sequence's parent data should be saved in DB`, () => {
        jobStorage.getDB()[childsParentCorrelationId].message.should.eql({
          type: "advertisement-order",
          id: "some-order-id",
          data: [ { type: "something", id: 1 } ],
        });
      });

      // eslint-disable-next-line no-loop-func
      And(`the grandchildren of the ${childName} sub-sequence should have been fulfilled`, () => {
        const expectedParentCorrelationId = `sub-sequence.child-subseq.trigger-sub-sequence.create-grandchildren-step:${childCorrelationId}`;
        const grandChildSequences = response.messages
          .filter(
            (m) => m.headers.parentCorrelationId === expectedParentCorrelationId);

        grandChildSequences
          .map(({ message: { id }, url, headers: { parentCorrelationId } }) => ({
            id,
            url,
            parentCorrelationId,
          })).should.eql([
            {
              id: "grandchild-1",
              url: "/v2/sub-sequence/grandchild-subseq",
              parentCorrelationId: expectedParentCorrelationId,
            },
            {
              id: "grandchild-2",
              url: "/v2/sub-sequence/grandchild-subseq",
              parentCorrelationId: expectedParentCorrelationId,
            },
            {
              id: "grandchild-1",
              url: "/v2/sub-sequence/grandchild-subseq/perform.something-in-grandchild",
              parentCorrelationId: expectedParentCorrelationId,
            },
            {
              id: "grandchild-2",
              url: "/v2/sub-sequence/grandchild-subseq/perform.something-in-grandchild",
              parentCorrelationId: expectedParentCorrelationId,
            },
            {
              id: "grandchild-1",
              url: "/v2/sub-sequence/grandchild-subseq/processed",
              parentCorrelationId: expectedParentCorrelationId,
            },
            {
              id: "grandchild-2",
              url: "/v2/sub-sequence/grandchild-subseq/processed",
              parentCorrelationId: expectedParentCorrelationId,
            },
          ]);
      });
    }
  });

  Scenario("Unsuccessfully attempt to triple-nest sub-sequences", () => {
    let broker;
    Given("a broker recipe that has sub-sequences nested too deep", () => {
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
                key: "sub-sequence.child-subseq",
                messages: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-children", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "child-subseq",
            sequence: [
              route(".trigger-sub-sequence.create-grandchildren-step", () => ({
                type: "trigger",
                key: "sub-sequence.grandchild-subseq",
                messages: [ { id: "grandchild-1" }, { id: "grandchild-2" } ],
              })),
              route(".perform.resumed-after-grandchildren", () => ({
                type: "Grandchildren done",
                id: "goodbye",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "grandchild-subseq",
            sequence: [
              route(".trigger-sub-sequence.create-great-grandchildren-step", () => ({
                type: "trigger",
                key: "sub-sequence.great-grandchild-subseq",
                messages: [ { id: "great-grandchild-1" }, { id: "great-grandchild-2" } ],
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "great-grandchild-subseq",
            sequence: [
              route(".perform.something-in-great-grandchild", ({ id }) => ({
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
      try {
        await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage, { "correlation-id": "abc123" });
      } catch (error) {
        response = error;
      }
    });

    Then("the response should indicate that we've nested too deep", () => {
      response.message.should.eql('Failed to process message, check the logs: {"statusCode":400,"body":{},"text":"It is only possible to nest one level of sub-sequences, you\'re trying to trigger sub-sequence.great-grandchild-subseq from sub-sequence.grandchild-subseq.trigger-sub-sequence.create-great-grandchildren-step which in turn was triggered from sub-sequence.child-subseq.trigger-sub-sequence.create-grandchildren-step - either rethink what you\'re trying to do, or implement great-grandchilden in b0rker..."}');
    });
  });
});
