import config from "exp-config";
import { fakePubSub } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Reject message", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
  });
  Scenario("Rejecting a message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, { rejectIf }) => {
                rejectIf(true, "rejected because..");
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

    And("that message should have published to dead letter queue", () => {
      const deadLetterMessage = fakePubSub.recordedMessages().pop();
      deadLetterMessage.topic.should.eql(config.deadLetterTopic);
      deadLetterMessage.message.error.should.eql({ message: "rejected because.." });
      deadLetterMessage.attributes.key.should.eql("sequence.advertisement-order.perform.step-1");
    });

    And("that message should preserve the original topic", () => {
      const deadLetterMessage = fakePubSub.recordedMessages().pop();
      deadLetterMessage.attributes.topic.should.eql("b0rker");
    });
  });
});
