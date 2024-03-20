import request from "supertest";
import { fakePubSub } from "@bonniernews/lu-test";

import { start } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Trigger handler", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
  });
  Scenario("Trigger a sequence with one lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": (message) => {
            const { type } = message;
            if (type === "advertisement-order") {
              return { type: "trigger", id: "sequence.advertisement-order" };
            }
            throw new Error("Unknown type");
          },
        },
        recipes: [],
      });
    });

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await request(broker).post("/trigger/advertisement-order").send(triggerMessage);
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [],
      });
    });
  });
});
