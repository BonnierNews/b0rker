import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

Feature("Broker sequence with 'run'", () => {
  Scenario("Trigger a sequence with multiple lambdas", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "step-1-was-here" };
              }),
              route(".perform.step-2", () => {
                return { type: "step-2", id: "step-2-was-here" };
              }),
              route(".perform.step-3", () => {
                return { type: "step-3", id: "step-3-was-here" };
              }),
            ],
          },
        ],
      });
    });
    const triggerMessage = {
      type: "advertisement-order",
      id: "some-order-id",
      correlationId: "some-corr-id",
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("four messages should have been published", () => {
      response.messages.length.should.eql(4);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages.pop().message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-2", id: "step-2-was-here" },
          { type: "step-3", id: "step-3-was-here" },
        ],
      });
    });
  });

  Scenario("Trigger a sequence with multiple lambdas, without a correlation id", () => {
    let broker;
    const correlationIds = [];
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message) => {
                correlationIds.push(message.correlationId);
                return { type: "step-1", id: "step-1-was-here" };
              }),
              route(".perform.step-2", (message) => {
                correlationIds.push(message.correlationId);
                return { type: "step-2", id: "step-2-was-here" };
              }),
              route(".perform.step-3", (message) => {
                correlationIds.push(message.correlationId);
                return { type: "step-3", id: "step-3-was-here" };
              }),
            ],
          },
        ],
      });
    });
    const triggerMessage = {
      type: "advertisement-order",
      id: "some-order-id",
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("four messages should have been published", () => {
      response.messages.length.should.eql(4);
    });

    And("they should all have the same correlationId, despite not sending any", () => {
      correlationIds.every((val, _, arr) => val === arr[0]).should.eql(true);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages.pop().message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-2", id: "step-2-was-here" },
          { type: "step-3", id: "step-3-was-here" },
        ],
      });
    });
  });

  Scenario("Trigger a sequence from a trigger handler", () => {
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
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "step-1-was-here" };
              }),
              route(".perform.step-2", () => {
                return { type: "step-2", id: "step-2-was-here" };
              }),
            ],
          },
        ],
      });
    });

    const triggerMessage = {
      type: "advertisement-order",
      id: "some-order-id",
      correlationId: "some-corr-id",
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", triggerMessage, {}, false);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("four messages should have been published", () => {
      response.messages.length.should.eql(4);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages.pop().message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-2", id: "step-2-was-here" },
        ],
      });
    });
  });
});
