import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Unrecoverable message", () => {
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("that message should have published with an unrecoverable suffix", () => {
      const messages = response.messages.pop();
      messages.url.should.eql("/v2/sequence/advertisement-order/perform.step-1/unrecoverable");
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("that message should have published with an unrecoverable suffix", () => {
      const message = response.messages.pop();
      message.message.error.message.should.eql("this is an error message");
      message.url.should.eql("/v2/sequence/advertisement-order/perform.step-1/unrecoverable");
    });
  });
});
