import nock from "nock";
import { fakeCloudTasks, fakeGcpAuth } from "@bonniernews/lu-test";
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
    fakeGcpAuth.reset();
  });

  const apiUrl = "https://test.local";
  Scenario("Using context http to make calls", () => {
    let broker;
    const fakeApi = nock(apiUrl);
    Given("there is an api we want to call", () => {
      fakeApi.get("/test").reply(200, { id: "123" });
    });

    And("broker is initiated with a recipe", () => {
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage);
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the endpoint should have been called", () => {
      fakeApi.pendingMocks().length.should.eql(0);
    });

    And("there should be a processed message", () => {
      response.url.should.eql("/v2/sequence/test/processed");
      response.message.data.should.eql([ { type: "testing", id: "123" } ]);
    });
  });

  Scenario("Using context http to make calls with the gcp proxy", () => {
    let broker;
    const fakeApi = nock(config.gcpProxy.url);
    Given("there is an api we want to call", () => {
      fakeApi.get("/some/test").reply(200, { id: "123" });
    });

    And("broker is initiated with a recipe", () => {
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

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/test", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the endpoint should have been called", () => {
      fakeApi.pendingMocks().length.should.eql(0);
    });

    And("there should be a processed message", () => {
      response.url.should.eql("/v2/sequence/test/processed");
      response.message.data.should.eql([ { type: "testing", id: "123" } ]);
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

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", {
        ...triggerMessage,
        attributes: { keepAttr: 1, someAttr: 2 },
      });
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("we should have published 6 messages", () => {
      response.messages.length.should.eql(6);
    });

    And("we should have recorded 2 processed messages", () => {
      response.messages
        .filter(({ url }) => url === "/v2/sequence/a-notification/processed")
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
              messages: [ { type: "some-type", id: "123" } ],
            };
          },
        },
        recipes: [],
      });
    });

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("we should have published 1 message", () => {
      response.messages.length.should.eql(1);
    });

    But("the published message should have gotten a 404", () => {
      response.messageHandlerResponses[0].statusCode.should.eql(404);
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

    let response;
    When("a trigger http call is received for an unknown sequence", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("we should have published 0 messages", () => {
      response.messages.length.should.eql(0);
    });
  });
});
