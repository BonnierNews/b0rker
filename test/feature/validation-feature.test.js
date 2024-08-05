import { fakeCloudTasks, fakePubSub } from "@bonniernews/lu-test";
import Joi from "joi";

import { route, start } from "../../index.js";

const schema = Joi.object({ foo: Joi.string().required() });

Feature("Sequence with validation", () => {
  afterEachScenario(() => {
    fakeCloudTasks.reset();
    fakePubSub.reset();
  });

  Scenario("Validation succeeds", () => {
    let broker;
    Given("broker is initiated with a recipe with a schema", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test-order",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "step-1-was-here" };
              }),
            ],
            schema,
          },
        ],
      });
    });

    const triggerMessage = {
      type: "test-order",
      id: "some-order-id",
      attributes: { foo: "bar" },
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the sequence should be processed", () => {
      response.messages
        .map(({ url }) => url)
        .should.eql([ "/v2/sequence/test-order/perform.step-1", "/v2/sequence/test-order/processed" ]);
    });
  });

  Scenario("Order is missing type and id", () => {
    let broker;
    Given("broker is initiated with a recipe with a schema", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test-order",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "step-1-was-here" };
              }),
            ],
            schema,
          },
        ],
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    const triggerMessage = { attributes: { foo: "bar" } };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test-order", triggerMessage, { "correlation-id": "some-epic-id" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the message should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub
        .recordedMessages()[0]
        .message.error.message.should.eql('Validation error: "type" is required, "id" is required');
    });

    And("the sequence should not be processed", () => {
      response.messages.map(({ url }) => url).should.eql([ "/v2/sequence/test-order/perform.step-1" ]);
    });
  });

  Scenario("Attribute validation fails", () => {
    let broker;
    Given("broker is initiated with a recipe with a schema", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test-order",
            sequence: [
              route(".perform.step-1", () => {
                return { type: "step-1", id: "step-1-was-here" };
              }),
            ],
            schema,
          },
        ],
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    const triggerMessage = {
      type: "test-order",
      id: "some-order-id",
      attributes: { foo: 42, iShouldNotBeHere: "nope" },
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test-order", triggerMessage, { "correlation-id": "some-epic-id" });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the message should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub
        .recordedMessages()[0]
        .message.error.message.should.eql(
          'Validation error: "attributes.foo" must be a string, "attributes.iShouldNotBeHere" is not allowed'
        );
    });

    And("the sequence should not be processed", () => {
      response.messages.map(({ url }) => url).should.eql([ "/v2/sequence/test-order/perform.step-1" ]);
    });
  });
});
