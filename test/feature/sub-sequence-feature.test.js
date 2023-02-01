import {start, route} from "../../index.js";
import {fakePubSub, fakeGcpAuth} from "@bonniernews/lu-test";

import nock from "nock";
import jobStorage from "../../lib/job-storage/index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id"
};

Feature("Child proccesses", () => {
  beforeEachScenario(() => {
    fakeGcpAuth.enableGetRequestHeaders();
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
              route(".trigger-sub-sequence.create-children-step", () => ({
                id: "123",
                type: "trigger",
                key: "sub-sequence.test2",
                data: [],
                source: [{id: "child-1"}, {id: "child-2"}]
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello"
              }))
            ]
          },
          {
            namespace: "sub-sequence",
            name: "test2",
            sequence: [
              route(".perform.something-in-child", ({id}) => ({
                type: `I was here ${id}`,
                id
              }))
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        {triggerMessage, correlationId: "abc123"},
        {
          key: "trigger.sequence.test"
        }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(9);
    });
    And("the last message should have correct format", () => {
      const last = [...fakePubSub.recordedMessages()].pop();
      last.attributes.should.contain({key: "sequence.test.processed"});
    });
    And("the children should have been added to the database and been completed", () => {
      jobStorage.getDB()[parentCorrId].completedJobs.length.should.eql(2);
    });
    And("the process data should be saved in DB", () => {
      jobStorage.getDB()[parentCorrId].message.should.eql({
        triggerMessage,
        correlationId: "abc123",
        data: [
          {
            id: "123",
            type: "trigger",
            key: "sub-sequence.test2",
            data: [],
            source: [{id: "child-1"}, {id: "child-2"}]
          }
        ]
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
                key: "sub-sequence.test2"
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello"
              }))
            ]
          },
          {
            namespace: "sub-sequence",
            name: "test2",
            sequence: [
              route(".perform.something-in-child", ({id}) => ({
                type: `I was here ${id}`,
                id
              }))
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        {triggerMessage, correlationId: "abc123"},
        {
          key: "trigger.sequence.test"
        }
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
                source: [{id: "child-1"}, {id: "child-2"}]
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello"
              }))
            ]
          },
          {
            namespace: "sequence",
            name: "test2",
            sequence: [
              route(".perform.something-in-child", ({id}) => ({
                type: `I was here ${id}`,
                id
              }))
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        {triggerMessage, correlationId: "abc123"},
        {
          key: "trigger.sequence.test"
        }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the message should be nacked because of bad handler response", () => {
      fakePubSub.recordedMessageHandlerResponses()[0].statusCode.should.eql(400);
    });
  });

  Scenario("Handler without trigger-sub-sequence in route returns a sub-sequence trigger", () => {
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
                source: [{id: "child-1"}, {id: "child-2"}]
              })),
              route(".perform.resumed-after-sub-sequense", () => ({
                type: "I am done",
                id: "hello"
              }))
            ]
          },
          {
            namespace: "sub-sequence",
            name: "test2",
            sequence: [
              route(".perform.something-in-child", ({id}) => ({
                type: `I was here ${id}`,
                id
              }))
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        {triggerMessage, correlationId: "abc123"},
        {
          key: "trigger.sequence.test"
        }
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
              route(".perform.something-in-child", ({id}) => ({
                type: `I was here ${id}`,
                id
              }))
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        {triggerMessage, correlationId: "abc123"},
        {
          key: "trigger.sub-sequence.test2"
        }
      );
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("all messages including children should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });
    And("the last message should have correct format", () => {
      const last = [...fakePubSub.recordedMessages()].pop();
      last.attributes.should.contain({key: "sub-sequence.test2.processed"});
    });
    And("the children should not have been added to the database", () => {
      jobStorage.getDB().should.eql({});
    });
  });
});
