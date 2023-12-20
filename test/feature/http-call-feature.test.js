import nock from "nock";
import { fakePubSub, fakeGcpAuth } from "@bonniernews/lu-test";
import config from "exp-config";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Make http call from lambda", () => {
  beforeEachScenario(() => {
    fakeGcpAuth.authenticated();
    nock.disableNetConnect();
    nock.enableNetConnect(/(localhost|127\.0\.0\.1):\d+/);
  });
  afterEachScenario(() => {
    fakePubSub.reset();
    fakeGcpAuth.reset();
  });

  const apiUrl = "https://test.local";
  Scenario("Using context http to make calls", () => {
    let broker;
    const fakeApi = nock(apiUrl);
    Given("there is an api we want to call", () => {
      fakeApi.get("/test").reply(200, { id: "123" });
    });

    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", async (message, context) => {
                const { body } = await context.http.get({ baseUrl: apiUrl, path: "/test" });
                return { type: "testing", id: body.id };
              }),
            ],
          },
        ],
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.sequence.test" });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the endpoint should have been called", () => {
      fakeApi.pendingMocks().length.should.eql(0);
    });

    And("there should be a processed message", () => {
      const last = fakePubSub.recordedMessages()[fakePubSub.recordedMessages().length - 1];
      last.attributes.key.should.eql("sequence.test.processed");
      last.message.data.should.eql([ { type: "testing", id: "123" } ]);
    });
  });

  Scenario("Using context http to make calls with the gcp proxy", () => {
    let broker;
    const fakeApi = nock(config.gcpProxy.url);
    Given("there is an api we want to call", () => {
      fakeApi.get("/some/test").reply(200, { id: "123" });
    });

    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", async (message, context) => {
                const { body } = await context.http.get({ path: "/some/test" });
                return { type: "testing", id: body.id };
              }),
            ],
          },
        ],
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.sequence.test" });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the endpoint should have been called", () => {
      fakeApi.pendingMocks().length.should.eql(0);
    });

    And("there should be a processed message", () => {
      const last = fakePubSub.recordedMessages()[fakePubSub.recordedMessages().length - 1];
      last.attributes.key.should.eql("sequence.test.processed");
      last.message.data.should.eql([ { type: "testing", id: "123" } ]);
    });
  });

  Scenario("Trigger a trigger handler from http, broken response key", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": () => {
            return { type: "trigger", key: "trigger.advertisement-order" };
          },
        },
        recipes: [],
      });
    });

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.order" });
    });

    Then("the status code should be 400 Bad Request", () => {
      response.statusCode.should.eql(400, response.text);
    });
  });

  Scenario("Trigger a trigger handler from http, source for sub-sequence is not an array", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": () => {
            return { type: "trigger", key: "trigger.sub-sequence.some-order", source: {} };
          },
        },
        recipes: [],
      });
    });

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.order" });
    });

    Then("the status code should be 400 Bad Request", () => {
      response.statusCode.should.eql(400, response.text);
    });
  });

  Scenario("Trigger a trigger handler from http, triggering multiple sequences", () => {
    let broker;

    function rewriteMessage(message) {
      delete message.attributes?.someAttr;
      return message;
    }

    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": (message) => {
            return {
              type: "trigger",
              key: "trigger.sequence.a-notification",
              messages: [
                { ...rewriteMessage(message), target: "t1" },
                { ...rewriteMessage(message), target: "t2" },
              ],
            };
          },
        },
        recipes: [
          {
            namespace: "sequence",
            name: "a-notification",
            sequence: [
              route(".perform.notification", (message, { rejectIf }) => {
                rejectIf(message.attributes?.someAttr, "someAttr is not allowed");
                return { type: "notification", id: message.id };
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
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakePubSub.triggerMessage(
        broker,
        { ...triggerMessage, attributes: { keepAttr: 1, someAttr: 2 } },
        { key: "trigger.order" }
      );
    });

    Then("the status code should be 200 Ok", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("we should have published 4 messages", () => {
      fakePubSub.recordedMessages().length.should.eql(4);
    });

    And("we should have recorded 2 processed messages", () => {
      fakePubSub
        .recordedMessages()
        .filter(({ attributes }) => attributes.key === "sequence.a-notification.processed")
        .length.should.eql(2);
    });
  });

  Scenario("Trigger a trigger handler from http, bad result from trigger", () => {
    let broker;

    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": () => {
            return {
              type: "trigger",
              key: "trigger.sequence.a-notification",
              messages: { type: "some-type", id: "123" },
            };
          },
        },
        recipes: [],
      });
    });

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.order" });
    });

    Then("the status code should be 400 Bad Request", () => {
      response.statusCode.should.eql(400, response.text);
    });

    And("we should have published 0 messages", () => {
      fakePubSub.recordedMessages().length.should.eql(0);
    });
  });

  Scenario("Trigger a trigger handler from http, empty result from trigger", () => {
    let broker;

    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        triggers: {
          "trigger.order": () => {
            return;
          },
        },
        recipes: [],
      });
    });

    And("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, { key: "trigger.order" });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("we should have published 0 messages", () => {
      fakePubSub.recordedMessages().length.should.eql(0);
    });
  });
});
