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
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("there should be one message handler response", () => {
      response.messageHandlerResponses.length.should.eql(1);
    });

    And("that message should have been nacked for retry", () => {
      const last = response.messageHandlerResponses.pop();
      last.statusCode.should.eql(400, response.text);
    });
  });
});
