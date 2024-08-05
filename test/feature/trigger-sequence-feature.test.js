import { fakeCloudTasks } from "@bonniernews/lu-test";
import { expect } from "chai";
import config from "exp-config";

import { route, start } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Trigger sequence by http call", () => {
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
    When("a trigger http call is received", async () => {
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

  Scenario("Trigger a sequence with one lambda using an /config.appName prefix in the route", () => {
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
    When("a trigger http call is received", async () => {
      response = await fakeCloudTasks.runSequence(
        broker,
        `/${config.appName}/v2/sequence/advertisement-order`,
        triggerMessage
      );
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

  Scenario("Trigger a sequence with one lambda correlationId in headers", () => {
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
    When("a trigger http call is received", async () => {
      response = await fakeCloudTasks.runSequence(
        broker,
        "/v2/sequence/advertisement-order",
        { type: "advertisement-order", id: "some-order-id" },
        { "correlation-id": "apa" }
      );
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("two messages should have been published", () => {
      response.messages.length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...response.messages ].pop();
      last.correlationId.should.eql("apa");
    });
  });

  Scenario("Trigger a sequence with one lambda with correlationId missing", () => {
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
    When("a trigger http call is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", {
        type: "advertisement-order",
        id: "some-order-id",
      });
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

    And("the message should contain a correlationId", () => {
      const last = [ ...response.messages ].pop();
      expect(last.correlationId).to.exist;
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
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/unknown-sequence", triggerMessage);
    });

    Then("the status code should be 404 Not Found", () => {
      response.firstResponse.statusCode.should.eql(404, response.text);
    });
  });
});
