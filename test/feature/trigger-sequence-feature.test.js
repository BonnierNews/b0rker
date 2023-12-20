import request from "supertest";
import { fakePubSub } from "@bonniernews/lu-test";
import { expect } from "chai";
import config from "exp-config";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Trigger sequence by http call", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
  });
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await request(broker).post("/trigger/sequence/advertisement-order").send(triggerMessage);
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await request(broker)
        .post(`/${config.appName}/trigger/sequence/advertisement-order`)
        .send(triggerMessage);
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await request(broker)
        .post("/trigger/sequence/advertisement-order")
        .set({ "x-correlation-id": "apa" })
        .send({
          type: "advertisement-order",
          id: "some-order-id",
        });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.attributes.correlationId.should.eql("apa");
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

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received", async () => {
      response = await request(broker).post("/trigger/sequence/advertisement-order").send({
        type: "advertisement-order",
        id: "some-order-id",
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("two messages should have been published", () => {
      fakePubSub.recordedMessages().length.should.eql(2);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      last.message.should.eql({
        ...triggerMessage,
        data: [ { type: "step-1", id: "step-1-was-here" } ],
      });
    });

    And("the message should contain a correlationId", () => {
      const last = [ ...fakePubSub.recordedMessages() ].pop();
      expect(last.attributes.correlationId).to.exist;
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
      response = await request(broker).post("/trigger/sequence/unknown-sequence").send(triggerMessage);
    });

    Then("the status code should be 400 Bad Request", () => {
      response.statusCode.should.eql(400, response.text);
    });

    And("the response should contain an error message", () => {
      response.body.should.eql({ error: "Unknown trigger key trigger.sequence.unknown-sequence" });
    });
  });
});
