import {start, route} from "../../index.js";
import fakePubSub from "../helpers/fake-pub-sub.js";
import nock from "nock";
import fakeGcpAuth from "../helpers/fake-gcp-auth.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id"
};

Feature("Make http call from lambda", () => {
  beforeEachScenario(() => {
    fakeGcpAuth.enableGetRequestHeaders();
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
    Given("there is an api we want to call", () => {
      nock(apiUrl).get("/test").reply(200, {id: "123"});
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
                const {body} = await context.http.get({baseUrl: apiUrl, path: "/test"});
                return {type: "testing", id: body.id};
              })
            ]
          }
        ]
      });
    });

    Given("we can publish messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakePubSub.triggerMessage(broker, triggerMessage, {
        key: "trigger.sequence.test"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("the endpoint should have been called", () => {
      nock.pendingMocks().length.should.eql(0);
    });

    And("there should be a processed message", () => {
      const last = fakePubSub.recordedMessages()[fakePubSub.recordedMessages().length - 1];
      last.attributes.key.should.eql("sequence.test.processed");
      last.message.data.should.eql([{type: "testing", id: "123"}]);
    });
  });
});
