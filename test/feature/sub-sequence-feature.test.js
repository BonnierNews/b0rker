import { fakeCloudTasks, fakeGcpAuth } from "@bonniernews/lu-test";
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(
        broker,
        "/v2/sequence/test",
        { triggerMessage },
        { "correlation-id": "abc123" }
      );
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("all messages including children should have been published", () => {
      response.messages.length.should.eql(10);
    });
    And("the last message should have correct format", () => {
      const last = [ ...response.messages ].pop();
      last.url.should.eql("/v2/sequence/test/processed");
      last.message.data.should.eql([
        { type: "something", id: 1 },
        { id: 2, type: "sub-sequence.test2.processed" },
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

    let response;
    When("a trigger message is received", async () => {
      try {
        await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage, { "correlation-id": "abc123" });
      } catch (error) {
        response = error;
      }
    });

    Then("we should receive an error", () => {
      response.message.should.eql(
        'Failed to process message, check the logs: {"statusCode":400,"body":{},"text":"Invalid result: messages need to be an array got: undefined"}'
      );
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

    let response;
    When("a trigger message is received", async () => {
      try {
        await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage, { "correlation-id": "abc123" });
      } catch (error) {
        response = error;
      }
    });

    Then("we should receive an error", () => {
      response.message.should.eql(
        'Failed to process message, check the logs: {"statusCode":400,"body":{},"text":"Invalid result: messages need to be an array got: undefined"}'
      );
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
                messages: [],
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage, { "correlation-id": "abc123" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("all messages should have been published", () => {
      response.messages.length.should.eql(4);
    });
    And("the last message should have correct format", () => {
      const last = [ ...response.messages ].pop();
      last.url.should.eql("/v2/sequence/test/processed");
      last.message.data.should.eql([
        { type: "something", id: 1 },
        { type: "I am done", id: "hello" },
      ]);
    });
    And("nothing should have been added to the database", () => {
      should.not.exist(jobStorage.getDB()[parentCorrId]);
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sub-sequence/test2", triggerMessage, { "correlation-id": "abc123" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("all messages including children should have been published", () => {
      response.messages.length.should.eql(2);
    });
    And("the last message should have correct format", () => {
      const last = [ ...response.messages ].pop();
      last.url.should.eql("/v2/sub-sequence/test2/processed");
    });
    And("the children should not have been added to the database", () => {
      jobStorage.getDB().should.eql({});
    });
  });

  Scenario("Same parent triggers twice at the same time (because pub/sub)", () => {
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

    let response1, response2;
    When("a trigger message is received, twice", async () => {
      response1 = await fakeCloudTasks.runSequence(
        broker,
        "/v2/sequence/test",
        { triggerMessage },
        { "correlation-id": "abc123" }
      );

      try {
        await fakeCloudTasks.runSequence(
          broker,
          "/v2/sequence/test",
          { triggerMessage },
          { "correlation-id": "abc123" }
        );
      } catch (error) {
        response2 = error;
      }
    });

    Then("the first status code should be 201 Created", () => {
      response1.firstResponse.statusCode.should.eql(201, response1.text);
    });

    And("the last message should have correct format", () => {
      const processedMessage = response1.messages.find((m) => m.url === "/v2/sequence/test/processed");
      processedMessage.message.data.should.eql([
        { type: "something", id: 1 },
        {
          id: 2,
          type: "sub-sequence.test2.processed",
        },
        { type: "I am done", id: "hello" },
      ]);
    });
    And("the 2 children should have been added to the database and been completed once", () => {
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

    And("the second triggering should have resulted in an error", () => {
      response2.message.should.eql(
        'Failed to process message, check the logs: {"statusCode":500,"body":{"type":"unknown","message":"6 ALREADY_EXISTS: Document already exists: memory/databases/(default)/documents/processed/sequence.test.trigger-sub-sequence.create-children-step:abc123"},"text":"{\\"type\\":\\"unknown\\",\\"message\\":\\"6 ALREADY_EXISTS: Document already exists: memory/databases/(default)/documents/processed/sequence.test.trigger-sub-sequence.create-children-step:abc123\\"}"}'
      );
    });
  });

  Scenario("Error occurs during sub-sequence processing", () => {
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
              route(".perform.something-in-child", ({ id }) => {
                throw new Error(`Something went wrong with ${id}`);
              }),
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      try {
        await fakeCloudTasks.runSequence(
          broker,
          "/v2/sequence/test",
          { triggerMessage },
          { "correlation-id": "abc123" }
        );
      } catch (error) {
        response = error;
      }
    });

    Then("we should receive an error", () => {
      response.message.should.eql(
        'Failed to process message, check the logs: {"statusCode":500,"body":{"type":"unknown","message":"Something went wrong with child-1"},"text":"{\\"type\\":\\"unknown\\",\\"message\\":\\"Something went wrong with child-1\\"}"}'
      );
    });
  });
});
