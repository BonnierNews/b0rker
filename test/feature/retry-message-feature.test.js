import {start, route} from "../../index.js";
import {fakePubSub} from "@bonniernews/lu-test";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id"
};

Feature("Retry message", () => {
  afterEachScenario(() => {
    fakePubSub.reset();
  });
  Scenario("Retrying a message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, {retryIf}) => {
                retryIf(true);
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
        key: "trigger.sequence.advertisement-order"
      });
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
    });

    And("there should be one message handler response", () => {
      fakePubSub.recordedMessageHandlerResponses().length.should.eql(1);
    });

    And("that message should have been nacked for retry", () => {
      const last = fakePubSub.recordedMessageHandlerResponses().pop();
      last.statusCode.should.eql(400, response.text);
    });
  });
});
