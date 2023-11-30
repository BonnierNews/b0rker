import { fakePubSub, fakeGcpAuth } from "@bonniernews/lu-test";
import nock from "nock";

import { start, route } from "../../index.js";
import jobStorage from "../../lib/job-storage/index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Child processes", () => {
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

  Scenario("Starting sub-sequences", () => {
    let broker;
    const parentCorrId = "sequence.test.trigger-sub-sequence.create-children-step:abc123";
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
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                data: [],
                messages: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage },
        // parentCorrelationId being undefined below should not affect the outcome
        { key: "trigger.sequence.test", correlationId: "abc123", parentCorrelationId: undefined }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(10);
    });
    And("the last message should have correct format", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.should.contain({ key: "sequence.test.processed" });
      last.message.data.should.eql([
        { type: "something", id: 1 },
        {
          id: 2,
          type: "sub-sequence.test2.processed",
        },
        { type: "I am done", id: "hello" },
      ]);
    });
    And("the children should have been added to the database and been completed", () => {
      jobStorage.getDB()[parentCorrId].completedJobsCount.should.eql(2);
    });
    And("the process data should be saved in DB", () => {
      jobStorage.getDB()[parentCorrId].message.should.eql({
        triggerMessage,
        data: [
          {
            type: "something",
            id: 1,
          },
        ],
      });
    });
  });

  Scenario("Handler returns a trigger without source", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage, correlationId: "abc123" },
        { key: "trigger.sequence.test" }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the message should be nacked because of bad handler response", () => {
      fakePubSub.recordedMessageHandlerResponses()[0].statusCode.should.eql(400);
    });
  });

  Scenario("Handler returns a trigger with invalid key", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sequence.test2",
                source: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage, correlationId: "abc123" },
        { key: "trigger.sequence.test" }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the message should be nacked because of bad handler response", () => {
      fakePubSub.recordedMessageHandlerResponses()[0].statusCode.should.eql(400);
    });
  });

  Scenario("No trigger messages for sub-sequence, skipping", () => {
    let broker;
    const parentCorrId = "sequence.test.trigger-sub-sequence.create-children-step:abc123";
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
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                data: [],
                messages: [ ],
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage },
        // parentCorrelationId being undefined below should not affect the outcome
        { key: "trigger.sequence.test", correlationId: "abc123", parentCorrelationId: undefined }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(4);
    });
    And("the last message should have correct format", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.should.contain({ key: "sequence.test.processed" });
      last.message.data.should.eql([
        { type: "something", id: 1 },
        { type: "I am done", id: "hello" },
      ]);
    });
    And("nothing should have been added to the database", () => {
      should.not.exist(jobStorage.getDB()[parentCorrId]);
    });
  });

  Scenario.skip("Handler without trigger-sub-sequence in route returns a sub-sequence trigger", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                messages: [ { id: "child-1" }, { id: "child-2" } ],
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage, correlationId: "abc123" },
        { key: "trigger.sequence.test" }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the message should be nacked because of bad handler response", () => {
      fakePubSub.recordedMessageHandlerResponses()[0].statusCode.should.eql(400);
    });
  });

  Scenario("Running a sub-sequence on its own", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage, correlationId: "abc123" },
        { key: "trigger.sub-sequence.test2" }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });
    And("the last message should have correct format", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.should.contain({ key: "sub-sequence.test2.processed" });
    });
    And("the children should not have been added to the database", () => {
      jobStorage.getDB().should.eql({});
    });
  });

  Scenario("Starting a bunch of sub-sequences, not enough to cause contention", () => {
    let broker;
    const parentCorrId = "sequence.test.trigger-sub-sequence.create-children-step:abc123";
    const manyChildren = [];
    for (let index = 0; index <= 9; index++) {
      manyChildren.push({ id: `child-${index}` });
    }
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
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                data: [],
                messages: manyChildren,
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage },
        // parentCorrelationId being undefined below should not affect the outcome
        { key: "trigger.sequence.test", correlationId: "abc123", parentCorrelationId: undefined }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(34);
    });
    And("the last message should be that the sequence is processed", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.should.contain({ key: "sequence.test.processed" });
      last.message.data.should.eql([
        { type: "something", id: 1 },
        {
          id: 10,
          type: "sub-sequence.test2.processed",
        },
        { type: "I am done", id: "hello" },
      ]);
    });
    And("the process data should be saved in DB", () => {
      jobStorage.getDB()[parentCorrId].message.should.eql({
        triggerMessage,
        data: [
          {
            type: "something",
            id: 1,
          },
        ],
      });
    });
    And("all 10 children should have been started", () => {
      jobStorage.getDB()[parentCorrId].startedJobsCount.should.eql(10);
    });
    And("all 10 children should have been completed", () => {
      jobStorage.getDB()[parentCorrId].completedJobsCount.should.eql(10);
    });
  });

  Scenario("Starting a lot of sub-sequences, guaranteed contention", () => {
    // in the test suite we set allowed contention low to make sure we get contention
    // this test doesn't check what causes the contention, just that it is handled
    let broker;
    const parentCorrId = "sequence.test.trigger-sub-sequence.create-children-step:abc123";
    const manyChildren = [];
    for (let index = 0; index <= 99; index++) {
      manyChildren.push({ id: `child-${index}` });
    }
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
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                data: [],
                messages: manyChildren,
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello",
              })),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "test2",
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { triggerMessage },
        // parentCorrelationId being undefined below should not affect the outcome
        { key: "trigger.sequence.test", correlationId: "abc123", parentCorrelationId: undefined }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(302);
    });
    And("the last message should be the last child processed", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.should.contain({ key: "sub-sequence.test2.processed" });
      last.message.data.should.eql([
        { type: "I was here child-99", id: "child-99" },
      ]);
    });
    And("the process data should be saved in DB", () => {
      jobStorage.getDB()[parentCorrId].message.should.eql({
        triggerMessage,
        data: [
          {
            type: "something",
            id: 1,
          },
        ],
      });
    });
    And("all 100 children should have been started", () => {
      jobStorage.getDB()[parentCorrId].startedJobsCount.should.eql(100);
    });
    But("none of the jobs will be listed as completed", () => {
      jobStorage.getDB()[parentCorrId].completedJobsCount.should.eql(0);
    });
  });
});
