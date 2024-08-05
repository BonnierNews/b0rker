import { fakeCloudTasks } from "@bonniernews/lu-test";
import config from "exp-config";

import { route, start } from "../../index.js";

const { queues } = config.cloudTasks;

Feature("Broker sequence with different queues", () => {
  Scenario("Trigger a sequence with lambdas using multiple queues", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "foo",
            sequence: [
              route(
                ".perform.step-1",
                () => {
                  return { type: "step-1", id: "step-1-was-here" };
                },
                { queue: "concurrencyLimited" }
              ),
              route(
                ".perform.step-2",
                () => {
                  return { type: "step-2", id: "step-2-was-here" };
                },
                { queue: "concurrencyLimited" }
              ),
              route(".perform.step-3", () => {
                return { type: "step-3", id: "step-3-was-here" };
              }),
            ],
          },
        ],
      });
    });
    const triggerMessage = {
      type: "foo",
      id: "some-order-id",
      correlationId: "some-corr-id",
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/foo", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages.slice(-1)[0].message.should.eql({
        ...triggerMessage,
        data: [
          { type: "step-1", id: "step-1-was-here" },
          { type: "step-2", id: "step-2-was-here" },
          { type: "step-3", id: "step-3-was-here" },
        ],
      });
    });

    And("the messages should have been published to the correct queues", () => {
      Object.fromEntries(response.messages.map(({ url, queue }) => [ url, queue ])).should.eql({
        "/v2/sequence/foo/perform.step-1": queues.concurrencyLimited,
        "/v2/sequence/foo/perform.step-2": queues.concurrencyLimited,
        "/v2/sequence/foo/perform.step-3": queues.default,
        "/v2/sequence/foo/processed": queues.default,
      });
    });
  });

  Scenario("Trigger a sequence with subsequences using multiple queues", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "foo",
            sequence: [
              route(".perform.first", () => {
                return { type: "first", id: "first-was-here" };
              }),
              route(".perform.trigger-subsequences", () => {
                return { type: "trigger", key: "sub-sequence.bar", messages: [ { attributes: {} } ] };
              }),
              route(
                ".perform.last",
                () => {
                  return { type: "last", id: "last-was-here" };
                },
                { queue: "concurrencyLimited" }
              ),
            ],
          },
          {
            namespace: "sub-sequence",
            name: "bar",
            sequence: [
              route(
                ".perform.sub-first",
                () => {
                  return { type: "first", id: "first-was-here" };
                },
                { queue: "concurrencyLimited" }
              ),
              route(".perform.sub-last", () => {
                return { type: "last", id: "last-was-here" };
              }),
            ],
          },
        ],
      });
    });
    const triggerMessage = {
      type: "foo-order",
      id: "some-order-id",
      correlationId: "some-corr-id",
    };

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/sequence/foo", triggerMessage);
    });

    Then("the status code should be 201 Created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("last message should contain original message and appended data from lambdas", () => {
      response.messages.slice(-1)[0].message.should.eql({
        ...triggerMessage,
        data: [
          { type: "first", id: "first-was-here" },
          { type: "sub-sequence.bar.processed", id: 1 },
          { type: "last", id: "last-was-here" },
        ],
      });
    });

    And("the messages should have been published to the correct queues", () => {
      Object.fromEntries(response.messages.map(({ url, queue }) => [ url, queue ])).should.eql({
        "/v2/sequence/foo/perform.first": queues.default,
        "/v2/sequence/foo/perform.trigger-subsequences": queues.default,
        "/v2/sub-sequence/bar": queues.default,
        "/v2/sub-sequence/bar/perform.sub-first": queues.concurrencyLimited,
        "/v2/sub-sequence/bar/perform.sub-last": queues.default,
        "/v2/sub-sequence/bar/processed": queues.default,
        "/v2/sequence/foo/perform.last": queues.concurrencyLimited,
        "/v2/sequence/foo/processed": queues.default,
      });
    });
  });
});
