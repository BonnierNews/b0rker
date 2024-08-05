import { fakeCloudTasks } from "@bonniernews/lu-test";
import config from "exp-config";

import { route, start } from "../../index.js";

const server = {
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
};

const expectedMessages = [
  "/v2/sequence/test/perform.second",
  "/v2/sequence/test/perform.third",
  "/v2/sequence/test/processed",
];

Feature("Resending a stuck message", () => {
  afterEachScenario(() => {
    fakeCloudTasks.reset();
  });

  Scenario("Resending a message", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start(server);
    });

    let response;
    When("a trigger message is received on the resend endpoint", async () => {
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

    And("the sequence should have been processed", () => {
      response.messages.map(({ url }) => url).should.eql(expectedMessages);
    });

    And("the resend number should be included in the task names", () => {
      checkTaskNames(response.messages);
    });
  });

  Scenario("Resending a message for the third time", () => {
    const resendNumber = 3;
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start(server);
    });

    let response;
    When("a trigger message is received on the resend endpoint the third time", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/resend", {
        relativeUrl: "/sequence/test/perform.second",
        body: {
          attributes: { foo: "bar" },
          data: [ { type: "first", id: "1" } ],
        },
        headers: { siblingCount: 3, "correlation-id": "some-epic-id", resendNumber },
        queue: config.cloudTasks.queues.default,
      });
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the sequence should have been processed", () => {
      response.messages.map(({ url }) => url).should.eql(expectedMessages);
    });

    And("the resend number should have been increased", () => {
      response.messages[0].headers.resendNumber.should.eql(4);
    });

    And("the resend number should be included in the task names", () => {
      checkTaskNames(response.messages, resendNumber);
    });
  });

  Scenario("Resending a message without retries", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start(server);
    });

    let response;
    When("a trigger message is received with the no retry header set", async () => {
      response = await fakeCloudTasks.runSequence(broker, "/v2/resend", {
        relativeUrl: "/sequence/test/perform.second",
        body: {
          attributes: { foo: "bar" },
          data: [ { type: "first", id: "1" } ],
        },
        headers: { siblingCount: 3, "correlation-id": "some-epic-id", "x-no-retry": "true" },
        queue: config.cloudTasks.queues.default,
      });
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the sequence should have been processed", () => {
      response.messages.map(({ url }) => url).should.eql(expectedMessages);
    });

    And("the resend number should be included in the task names", () => {
      checkTaskNames(response.messages);
    });

    And("the no retry header should be included in the task header for the first task", () => {
      response.messages[0].headers["x-no-retry"].should.eql("true");
    });

    And("the no retry header should not be included in the task header for the remaining tasks", () => {
      response.messages
        .filter((_, index) => index > 0)
        .forEach(({ headers }) => should.not.exist(headers["x-no-retry"]));
    });
  });
});

function checkTaskNames(messages, resendNumber = 0) {
  const queue = config.cloudTasks.queues.default;
  const [ taskName1, taskName2, taskName3 ] = messages.map(({ taskName }) => taskName);

  taskName1.should.match(
    new RegExp(`${queue}/tasks/sequence_test_perform_second__.*__some-epic-id__re${resendNumber + 1}`)
  );
  taskName2.should.match(new RegExp(`${queue}/tasks/sequence_test_perform_third__.*__some-epic-id`));
  taskName3.should.match(new RegExp(`${queue}/tasks/sequence_test_processed__.*__some-epic-id`));
}
