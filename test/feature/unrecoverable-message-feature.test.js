import { fakePubSub } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Unrecoverable message", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
  });
  Scenario("Unrecoverable message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, { unrecoverableIf }) => {
                unrecoverableIf(true);
              }),
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
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.sequence.advertisement-order" });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("that message should have published with an unrecoverable suffix", () => {
      const messages = fakePubSub.recordedMessages().pop();
      messages.attributes.key.should.eql("sequence.advertisement-order.perform.step-1.unrecoverable");
    });
  });

  Scenario("Unrecoverable unless message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, { unrecoverableUnless }) => {
                unrecoverableUnless(false, "this is an error message");
              }),
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
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.sequence.advertisement-order" });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("that message should have published with an unrecoverable suffix", () => {
      const messages = fakePubSub.recordedMessages().pop();
      messages.message.error.message.should.eql("this is an error message");
      messages.attributes.key.should.eql("sequence.advertisement-order.perform.step-1.unrecoverable");
    });
  });
});
