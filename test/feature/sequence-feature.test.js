import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Broker sequence", () => {
  Scenario("Trigger a sequence with one lambda", () => {
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
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage, { "correlation-id": "some-correlation-id" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("two messages should have been published", () => {
      response.messages.length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.url.should.eql("/v2/sequence/advertisement-order/processed");
      last.headers.correlationId.should.eql("some-correlation-id");
      last.message.should.eql({
        ...triggerMessage,
        data: [ { type: "step-1", id: "step-1-was-here" } ],
      });
    });
  });

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
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-2", id: "step-2-was-here" },
          { type: "step-3", id: "step-3-was-here" },
        ],
      });
    });
  });

  Scenario("Trigger an unrecoverable sequence with multiple lambdas", () => {
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
              route(".perform.step-2", (message, context) => {
                context.unrecoverableUnless(false, "some error");
                return { type: "step-2", id: "step-2-was-here" };
              }),
            ],
            unrecoverable: [
              route("*", () => {
                return { type: "unrecoverable", id: "unrecoverable-handler" };
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

    And("four messages should have been published", () => {
      response.messages.length.should.eql(4);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages
        .map((m) => m.url)
        .should.eql([
          "/v2/sequence/advertisement-order/perform.step-1",
          "/v2/sequence/advertisement-order/perform.step-2",
          "/v2/sequence/advertisement-order/perform.step-2/unrecoverable",
          "/v2/sequence/advertisement-order/perform.step-2/unrecoverable/processed",
        ]);
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        error: { message: "some error" },
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "unrecoverable", id: "unrecoverable-handler" },
        ],
      });
    });
  });

  Scenario("Return array from handler", () => {
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
                return [
                  { type: "step-1", id: "step-1-was-here" },
                  { type: "step-1-again", id: "step-1-was-here-again" },
                ];
              }),
              route(".perform.step-2", () => {
                return { type: "step-2", id: "step-2-was-here" };
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

    And("four messages should have been published", () => {
      response.messages.length.should.eql(3);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-1-again", id: "step-1-was-here-again" },
          { type: "step-2", id: "step-2-was-here" },
        ],
      });
    });
  });

  Scenario("Return nothing from handler", () => {
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
                return;
              }),
              route(".perform.step-2", () => {
                return { type: "step-2", id: "step-2-was-here" };
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

    And("four messages should have been published", () => {
      response.messages.length.should.eql(3);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [ { type: "step-2", id: "step-2-was-here" } ],
      });
    });
  });

  Scenario("Trigger an unknown sequence", () => {
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
            ],
          },
        ],
      });
    });

    let response;
    When("an unknown trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/unknown", triggerMessage);
    });

    Then("the status code should be 404 not found", () => {
      response.firstResponse.statusCode.should.eql(404, response.text);
    });
  });

  Scenario("Sequence with async lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", async () => {
                const promise = new Promise((resolve) => {
                  return resolve({ type: "step-1", id: "step-1-was-here" });
                });
                return await promise;
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

    And("two messages should have been published", () => {
      response.messages.length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [ { type: "step-1", id: "step-1-was-here" } ],
      });
    });
  });

  Scenario("Lambda should have access to message and data from previous steps", () => {
    let performOne;
    let firstLambdaMessage;
    Given("a lambda that access message", () => {
      performOne = (message) => {
        firstLambdaMessage = message;
        return { type: "step-1", id: "step-1-was-here" };
      };
    });

    let performTwo;
    let secondLambdaMessage;
    And("a lambda that access message data from previous step", () => {
      performTwo = (message) => {
        secondLambdaMessage = message;
      };
    });

    let broker;
    And("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [ route(".perform.step-1", performOne), route(".perform.step-2", performTwo) ],
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

    And("the first lambda should have gotten the message", () => {
      firstLambdaMessage.should.eql({ ...triggerMessage, data: [] });
    });

    And("the second lambda should have gotten the message and data from first lambda", () => {
      secondLambdaMessage.should.eql({
        ...triggerMessage,
        data: [
          {
            id: "step-1-was-here",
            type: "step-1",
          },
        ],
      });
    });
  });

  Scenario("Trigger a sequence and that triggers new messages from lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "bananas",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "bananas-1-was-here" };
              }),
              route(".perform.step-2", () => {
                return {
                  type: "trigger",
                  key: "sequence.apples",
                  messages: [
                    { id: 1, type: "apples-1" },
                    { id: 2, type: "apples-2" },
                    { id: 3, type: "apples-3" },
                  ],
                };
              }),
            ],
          },
          {
            namespace: "sequence",
            name: "apples",
            sequence: [
              route(".perform.step-1", ({ type }) => {
                return { type: "step-1", id: type };
              }),
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/bananas", triggerMessage, { "correlation-id": "some-correlation-id" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("twelve messages should have been published", () => {
      response.messages.length.should.eql(12);
    });

    And("we should have 4 processed sequences", () => {
      response.messages.filter(({ url }) => url.endsWith("/processed")).length.should.eql(4);
    });

    And(
      "last message from the main sequence should contain original message and appended data from the first lambda",
      () => {
        const last = response.messages.filter(({ url }) => url.startsWith("/v2/sequence/bananas")).pop();

        last.correlationId.should.eql("some-correlation-id");
        last.url.should.eql("/v2/sequence/bananas/processed");
        last.message.should.eql({
          ...triggerMessage,
          data: [ { type: "step-1", id: "bananas-1-was-here" } ],
        });
      }
    );
  });
});
