import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Retry message", () => {
  Scenario("Retrying a message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, { retryIf }) => {
                retryIf(true);
              }),
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      try {
        await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
      } catch (error) {
        response = error;
      }
    });

    Then("the message should be retried", () => {
      response.message.should.eql('Failed to process message, check the logs: {"statusCode":400,"body":{"type":"retry"},"test":"{\\"type\\":\\"retry\\"}"}');
    });
  });
});
