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

  Scenario("Trigger a sequence with one lambda multiple times", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": (message) => {
            const { type } = message;
            if (type === "name") {
              return { type: "trigger", id: "sequence.name" };
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
      response = await request(broker)
        .post("/trigger/bulk/order")
        .send({
          messages: [
            { id: 1, type: "name" },
            { id: 2, type: "name" },
          ],
        });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      fakePubSub.recordedMessages().should.eql([
        {
          topic: "b0rker",
          message: { id: 1, type: "name" },
          attributes: {
            key: "trigger.order",
            correlationId: fakePubSub.recordedMessages()[0].attributes.correlationId,
            idempotencyKey: fakePubSub.recordedMessages()[0].attributes.idempotencyKey,
            topic: "b0rker",
          },
          deliveryAttempt: 1,
        },
        {
          topic: "b0rker",
          message: { id: 2, type: "name" },
          attributes: {
            key: "trigger.order",
            correlationId: fakePubSub.recordedMessages()[1].attributes.correlationId,
            idempotencyKey: fakePubSub.recordedMessages()[1].attributes.idempotencyKey,
            topic: "b0rker",
          },
          deliveryAttempt: 1,
        },
      ]);
    });
  });

  Scenario("Sending messages as an object", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": (message) => {
            const { type } = message;
            if (type === "name") {
              return { type: "trigger", id: "sequence.name" };
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
      response = await request(broker)
        .post("/trigger/bulk/order")
        .send({ messages: { id: 1, type: "name" } });
    });

    Then("the status code should be 400 Bad Request", () => {
      response.statusCode.should.eql(400, response.text);
    });

    And("the body should contain an error", () => {
      response.body.should.eql({ error: '"messages" must be an array' });
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(0);
    });
  });
});
