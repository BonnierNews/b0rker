import { fakeCloudTasks } from "@bonniernews/lu-test";
import config from "exp-config";

import { route, start } from "../../index.js";

Feature("Resending a stuck message", () => {
  afterEachScenario(() => {
    fakeCloudTasks.reset();
  });

  Scenario("Resending a message", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.first", () => ({ type: "first", id: "1" })),
              route(".perform.second", () => ({ type: "second", id: "2" })),
              route(".perform.third", () => ({ type: "third", id: "3" })),
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/resend", {
        relativeUrl: "/sequence/test/perform.second",
        body: {
          attributes: { foo: "bar" },
          data: [ { type: "first", id: "1" } ],
        },
        headers: { siblingCount: 3, "correlation-id": "some-epic-id" },
        queue: config.cloudTasks.queues.default,
      });
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("there sequence should have been processed", () => {
      response.messages
        .map(({ url }) => url)
        .should.eql([
          "/v2/sequence/test/perform.second",
          "/v2/sequence/test/perform.third",
          "/v2/sequence/test/processed",
        ]);
    });

    And("the resend number should be included in the task names", () => {
      const queue = config.cloudTasks.queues.default;
      const [ taskName1, taskName2, taskName3 ] = response.messages.map(({ taskName }) => taskName);

      taskName1.should.match(new RegExp(`${queue}/tasks/sequence_test_perform_second__.*__some-epic-id__re1`));
      taskName2.should.match(new RegExp(`${queue}/tasks/sequence_test_perform_third__.*__some-epic-id`));
      taskName3.should.match(new RegExp(`${queue}/tasks/sequence_test_processed__.*__some-epic-id`));
    });
  });

  Scenario("Resending a message again", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.first", () => ({ type: "first", id: "1" })),
              route(".perform.second", () => ({ type: "second", id: "2" })),
              route(".perform.third", () => ({ type: "third", id: "3" })),
            ],
          },
        ],
      });
    });

    let response;
    When("a trigger message is received", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/resend", {
        relativeUrl: "/sequence/test/perform.second",
        body: {
          attributes: { foo: "bar" },
          data: [ { type: "first", id: "1" } ],
        },
        headers: { siblingCount: 3, "correlation-id": "some-epic-id", resendNumber: 3 },
        queue: config.cloudTasks.queues.default,
      });
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("there sequence should have been processed", () => {
      response.messages
        .map(({ url }) => url)
        .should.eql([
          "/v2/sequence/test/perform.second",
          "/v2/sequence/test/perform.third",
          "/v2/sequence/test/processed",
        ]);
    });

    And("the resend number should have been increased", () => {
      response.messages[0].headers.resendNumber.should.eql(4);
    });

    And("the resend number should be included in the task names", () => {
      const queue = config.cloudTasks.queues.default;
      const [ taskName1, taskName2, taskName3 ] = response.messages.map(({ taskName }) => taskName);

      taskName1.should.match(new RegExp(`${queue}/tasks/sequence_test_perform_second__.*__some-epic-id__re4`));
      taskName2.should.match(new RegExp(`${queue}/tasks/sequence_test_perform_third__.*__some-epic-id`));
      taskName3.should.match(new RegExp(`${queue}/tasks/sequence_test_processed__.*__some-epic-id`));
    });
  });
});
