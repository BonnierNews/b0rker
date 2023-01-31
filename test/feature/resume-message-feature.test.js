import config from "exp-config";
import {start, route} from "../../index.js";
import nock from "nock";
import testHelpers from "lu-test";

const {fakePubSub, fakeGcpAuth, fakeCloudTask} = testHelpers;

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id"
};

Feature("Resume message", () => {
  beforeEachScenario(() => {
    fakeGcpAuth.enableGetRequestHeaders();
    nock.disableNetConnect();
    nock.enableNetConnect(/(localhost|127\.0\.0\.1):\d+/);
  });
  afterEachScenario(() => {
    fakePubSub.reset();
    fakeGcpAuth.reset();
    fakeCloudTask.reset();
  });

  Scenario("Resuming message in sequence", () => {
    let broker;
    let called = false;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.resume-step", () => {
                if (!called) {
                  called = true;
                  return {type: "resume", delayMs: 1000};
                }
                return {type: "some-type", id: "some-id"};
              })
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("we can create cloud tasks", () => {
      fakeCloudTask.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.test"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be a processed message", () => {
      const last = [...fakePubSub.recordedMessages()].pop();
      last.attributes.key.should.eql("sequence.test.processed");
      last.message.data.should.eql([{type: "some-type", id: "some-id"}]);
    });

    And("a task should have been published", () => {
      const last = [...fakeCloudTask.recordedMessages()].pop();
      last.message.should.eql({
        resumedCount: 1,
        key: "sequence.test.perform.resume-step",
        message: {
          ...triggerMessage,
          data: []
        }
      });
    });
  });

  Scenario("Resuming message max times", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.resume-step", () => {
                return {type: "resume", delayMs: 1000};
              })
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("we can create cloud tasks", () => {
      fakeCloudTask.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.test"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be max + 1 message handler responses", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(11);
    });

    And("the message should have been rejected", () => {
      const last = [...fakePubSub.recordedMessages()].pop();
      last.topic.should.eql(config.deadLetterTopic);
      last.message.error.should.eql("To many resume retries. Retries: 10", last.message);
    });
  });

  Scenario("Bad delayMs", () => {
    let broker;
    let called = false;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.resume-step", () => {
                if (!called) {
                  called = true;
                  return {type: "resume", delayMs: 1};
                }
                return {type: "some-type", id: "some-id"};
              })
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
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.test"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be one message handler response", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(1);
    });

    And("that message should have been nacked for retry", () => {
      const last = fakePubSub.recordedMessageHandlerResponses().pop();
      last.statusCode.should.eql(400, response.text);
    });
  });

  Scenario("Error when creating scheduled task", () => {
    let broker;
    let called = false;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.resume-step", () => {
                if (!called) {
                  called = true;
                  return {type: "resume", delayMs: 1000};
                }
                return {type: "some-type", id: "some-id"};
              })
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("create scheduled task errors", () => {
      fakeCloudTask.fakeCreateTaskError();
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.test"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be one message handler response", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(1);
    });

    And("that message should have been nacked for retry", () => {
      const last = fakePubSub.recordedMessageHandlerResponses().pop();
      last.statusCode.should.eql(500, response.text);
    });
  });
});
