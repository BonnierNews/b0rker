import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Trigger handler", () => {
  Scenario("Trigger a sequence with one lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": (message) => {
            const { type } = message;
            if (type === "advertisement-order") {
              return { type: "trigger", key: "trigger.sequence.advertisement-order" };
            }
            throw new Error("Unknown type");
          },
        },
        recipes: [],
      });
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("two messages should have been published", () => {
      response.messages.length.should.eql(1);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [],
      });
    });
  });
});
