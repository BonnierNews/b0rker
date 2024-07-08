import { fakeCloudTasks } from "@bonniernews/lu-test";

import { start } from "../../index.js";

const triggerMessage = {
  type: "advertisement-order",
  id: "some-order-id",
};

Feature("Trigger handler", () => {
  Scenario("Trigger a sequence with one lambda", () => {
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
        recipes: [],
      });
    });

    let response;
    When("a trigger http call is received", async () => {
      try {
        await fakeCloudTasks.runSequence(broker, "/v2/trigger/order", triggerMessage, {}, false);
      } catch (error) {
        response = error;
      }
    });

    Then("the status code should be 201 Created", () => {
      response.message.should.eql(
        'Failed to process message, check the logs: {"statusCode":404,"body":{},"text":"<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>\\n<meta charset=\\"utf-8\\">\\n<title>Error</title>\\n</head>\\n<body>\\n<pre>Cannot POST /v2/sequence/advertisement-order</pre>\\n</body>\\n</html>\\n"}'
      );
    });
  });
});
