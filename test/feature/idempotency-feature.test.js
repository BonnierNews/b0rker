import { fakePubSub } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";
import jobStorage from "../../lib/job-storage/index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Message idempotency", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
    jobStorage.clearDB();
  });

  Scenario("Same message gets redelivered", () => {
    let broker;
    let processedCount = 0;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [ route(".perform.step-1", () => {
              processedCount++;
            }) ],
          },
        ],
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.advertisement-order",
        deliveryAttempt: 1,
        idempotencyKey: "some-epic-key",
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the trigger message is redelivered with the same idempotency key", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.advertisement-order",
        deliveryAttempt: 1,
        idempotencyKey: "some-epic-key",
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be two message handler responses", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(2);
    });

    And("we should only have processed one message", () => {
      processedCount.should.eql(1);
    });
  });

  Scenario("Message gets retried", () => {
    let broker;
    let processedCount = 0;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [ route(".perform.step-1", () => {
              processedCount++;
            }) ],
          },
        ],
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received and retried", async () => {
      await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.advertisement-order",
        deliveryAttempt: 1,
        idempotencyKey: "some-epic-key",
      });

      await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.advertisement-order",
        deliveryAttempt: 2,
        idempotencyKey: "some-epic-key",
      });
    });

    And("there should be two message handler responses", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(2);
    });

    And("we should have processed both messages", () => {
      processedCount.should.eql(2);
    });
  });
});
