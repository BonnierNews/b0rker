import config from "exp-config";
import { fakeCloudTasks, fakePubSub } from "@bonniernews/lu-test";

import { start, route } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Reject message", () => {
  Scenario("Rejecting a message from a lambda", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "advertisement-order",
            sequence: [
              route(".perform.step-1", (message, { rejectIf }) => {
                rejectIf(true, "rejected because..");
              }),
            ],
          },
        ],
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/advertisement-order", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    let deadLetterMessage;
    And("that message should have published to dead letter queue", () => {
      deadLetterMessage = fakePubSub.recordedMessages().pop();
      deadLetterMessage.topic.should.eql(config.deadLetterTopic);
      deadLetterMessage.message.error.should.eql({ message: "rejected because.." });
      deadLetterMessage.attributes.key.should.eql("sequence.advertisement-order.perform.step-1");
    });

    And("that message should show that it originates from cloud tasks", () => {
      deadLetterMessage.attributes.origin.should.eql("cloudTasks");
      deadLetterMessage.attributes.queue.should.eql(config.cloudTasks.queues.default.split("/").pop());
    });
  });
});
