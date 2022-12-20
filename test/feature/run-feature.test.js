import {start, route} from "../../index.js";
import run from "../helpers/run.js";

Feature("Broker sequence with 'run'", () => {
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
                return {type: "step-1", id: "step-1-was-here"};
              }),
              route(".perform.step-2", () => {
                return {type: "step-2", id: "step-2-was-here"};
              }),
              route(".perform.step-3", () => {
                return {type: "step-3", id: "step-3-was-here"};
              })
            ]
          }
        ]
      });
    });
    const triggerMessage = {
      type: "advertisement-order",
      id: "some-order-id",
      correlationId: "some-corr-id"
    };

    let last;
    When("a trigger message is received", async () => {
      last = await run(broker, "trigger.sequence.advertisement-order", triggerMessage);
    });

    And("four messages should have been published", () => {
      last.message.data.length.should.eql(3);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      last.message.should.eql({
        ...triggerMessage,
        data: [
          {type: "step-1", id: "step-1-was-here"},
          {type: "step-2", id: "step-2-was-here"},
          {type: "step-3", id: "step-3-was-here"}
        ]
      });
    });
  });
});
