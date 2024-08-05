import { fakeCloudTasks, fakePubSub } from "@bonniernews/lu-test";
import { CloudTasksClient } from "@google-cloud/tasks";
import config from "exp-config";
import { createSandbox } from "sinon";
import request from "supertest";

import { route, start } from "../../index.js";

const maxRetries = config.maxRetries || 10;

Feature("Messages with too many retries get sent to the DLX", () => {
  afterEachScenario(() => {
    fakeCloudTasks.reset();
    fakePubSub.reset();
  });

  Scenario("A message gets retried the last time", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", () => {
                return { type: "testing", id: "some-epic-id" };
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
      response = await fakeCloudTasks.runSequence(
        broker,
        "/v2/sequence/test",
        {},
        { "X-CloudTasks-TaskRetryCount": maxRetries }
      );
    });

    Then("the status code should be 201 created", () => {
      response.firstResponse.statusCode.should.eql(201, response.text);
    });

    And("the sequence should have been processed", () => {
      response.messages
        .map(({ url }) => url)
        .should.eql([ "/v2/sequence/test/perform.http-step", "/v2/sequence/test/processed" ]);
    });

    And("no messages should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(0);
    });
  });

  Scenario("A message gets retried one time too many", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", () => {
                return { type: "testing", id: "some-epic-id" };
              }),
            ],
          },
        ],
      });
    });

    And("we can publish cloud tasks", () => {
      fakeCloudTasks.enablePublish(broker);
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a specific message is received", async () => {
      response = await request(broker)
        .post("/v2/sequence/test/perform.http-step")
        .send({})
        .set({ "X-CloudTasks-TaskRetryCount": maxRetries + 1, "correlation-id": "some-epic-id" });
      await fakeCloudTasks.processMessages();
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
      response.body.should.eql({ type: "dlx", message: "Max retries reached" });
    });

    But("there should be no more processed messages", () => {
      fakeCloudTasks.recordedMessages().length.should.eql(0);
    });

    And("the message should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub.recordedMessages()[0].should.deep.eql({
        deliveryAttempt: 1,
        message: { error: { message: "Max retries reached" } },
        topic: config.deadLetterTopic,
        attributes: {
          correlationId: "some-epic-id",
          key: "sequence.test.perform.http-step",
          origin: "cloudTasks",
          runId: fakePubSub.recordedMessages()[0].attributes.runId,
          appName: config.appName,
          relativeUrl: "sequence/test/perform.http-step",
          retryCount: (maxRetries + 1).toString(),
        },
      });
    });
  });

  Scenario("A message runs once and then doesn't retry because of no retry header", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", (message, { retryIf }) => {
                retryIf(true);
              }),
            ],
          },
        ],
      });
    });

    And("we can publish cloud tasks", () => {
      fakeCloudTasks.enablePublish(broker);
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let firstResponse;
    When("a specific message is received the first time", async () => {
      firstResponse = await request(broker)
        .post("/v2/sequence/test/perform.http-step")
        .send({ })
        .set({ "correlation-id": "some-epic-id", "x-no-retry": "true" });
      await fakeCloudTasks.processMessages();
    });

    Then("the status code should be 400", () => {
      firstResponse.statusCode.should.eql(400, firstResponse.text);
      firstResponse.body.should.eql({ type: "retry" });
    });

    And("there should be no more processed messages", () => {
      fakeCloudTasks.recordedMessages().length.should.eql(0);
    });

    let secondReponse;
    When("the message is received the second time", async () => {
      secondReponse = await request(broker)
        .post("/v2/sequence/test/perform.http-step")
        .send({ })
        .set({ "correlation-id": "some-epic-id", "x-no-retry": "true", "x-cloudtasks-taskretrycount": 1 });
      await fakeCloudTasks.processMessages();
    });

    Then("the status code should be 200 OK", () => {
      secondReponse.statusCode.should.eql(200, secondReponse.text);
      secondReponse.body.should.eql({ type: "dlx", message: "Max retries reached" });
    });

    But("there should be no more processed messages", () => {
      fakeCloudTasks.recordedMessages().length.should.eql(0);
    });

    And("the message should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub.recordedMessages()[0].should.deep.eql({
        deliveryAttempt: 1,
        message: { error: { message: "Max retries reached" } },
        topic: config.deadLetterTopic,
        attributes: {
          correlationId: "some-epic-id",
          key: "sequence.test.perform.http-step",
          origin: "cloudTasks",
          runId: fakePubSub.recordedMessages()[0].attributes.runId,
          appName: config.appName,
          relativeUrl: "sequence/test/perform.http-step",
          retryCount: "1",
        },
      });
    });
  });
});

Feature("Manual retry gets sent to DLX", () => {
  afterEachScenario(() => {
    fakeCloudTasks.reset();
    fakePubSub.reset();
  });

  Scenario("A message gets retried the last time", () => {
    const manualRetryMessage = "Manual retry message";
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", (_, { retryIf }) => {
                retryIf(true, manualRetryMessage);
              }),
            ],
          },
        ],
      });
    });

    And("we can publish cloud tasks", () => {
      fakeCloudTasks.enablePublish(broker);
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    let response;
    When("a specific message is received", async () => {
      response = await request(broker)
        .post("/v2/sequence/test/perform.http-step")
        .send({})
        .set({ "X-CloudTasks-TaskRetryCount": maxRetries, "correlation-id": "some-epic-id" });
      await fakeCloudTasks.processMessages();
    });

    Then("the status code should be 200 OK", () => {
      response.statusCode.should.eql(200, response.text);
      response.body.should.eql({ type: "dlx", message: `Max retries reached. Last message: "${manualRetryMessage}"` });
    });

    But("there should be no more processed messages", () => {
      fakeCloudTasks.recordedMessages().length.should.eql(0);
    });

    And("the message should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub.recordedMessages()[0].should.deep.eql({
        deliveryAttempt: 1,
        message: { error: { message: `Max retries reached. Last message: "${manualRetryMessage}"` } },
        topic: config.deadLetterTopic,
        attributes: {
          correlationId: "some-epic-id",
          key: "sequence.test.perform.http-step",
          origin: "cloudTasks",
          runId: fakePubSub.recordedMessages()[0].attributes.runId,
          appName: config.appName,
          relativeUrl: "sequence/test/perform.http-step",
          retryCount: maxRetries.toString(),
        },
      });
    });
  });
});

Feature("Sequence trigger failure gets sent to the DLX", () => {
  const sandbox = createSandbox();

  afterEachScenario(() => {
    fakePubSub.reset();
    sandbox.restore();
  });

  Scenario("An error is raised in the sequence start handler", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", () => {
                return { type: "testing", id: "some-epic-id" };
              }),
            ],
          },
        ],
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("Cloud Tasks throws an error", () => {
      sandbox.stub(CloudTasksClient.prototype).createTask = () => {
        throw new Error("Cloud Tasks error");
      };
    });

    let response;
    When("a trigger message is received", async () => {
      response = await request(broker).post("/v2/sequence/test").set({ "correlation-id": "some-epic-id" }).send({});
    });

    Then("the status code should be 500 error", () => {
      response.statusCode.should.eql(500, response.text);
    });

    And("one messages should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub.recordedMessages()[0].should.deep.eql({
        attributes: {
          appName: config.appName,
          correlationId: "some-epic-id",
          retryCount: "0",
          runId: fakePubSub.recordedMessages()[0].attributes.runId,
          relativeUrl: "sequence/test",
          key: "sequence.test",
          origin: "cloudTasks",
        },
        deliveryAttempt: 1,
        message: { error: { message: "Failed to start sequence" } },
        topic: config.deadLetterTopic,
      });
    });
  });

  Scenario("An error is raised in the trigger handler", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", () => {
                return { type: "testing", id: "some-epic-id" };
              }),
            ],
          },
        ],
        triggers: { "trigger.start": () => ({ type: "trigger", key: "sequence.test", messages: [ { attributes: {} } ] }) },
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("Cloud Tasks throws an error", () => {
      sandbox.stub(CloudTasksClient.prototype).createTask = () => {
        throw new Error("Cloud Tasks error");
      };
    });

    let response;
    When("a trigger message is received", async () => {
      response = await request(broker).post("/v2/trigger/start").set({ "correlation-id": "some-epic-id" }).send({});
    });

    Then("the status code should be 500 error", () => {
      response.statusCode.should.eql(500, response.text);
    });

    And("one messages should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(1);
      fakePubSub.recordedMessages()[0].should.deep.eql({
        attributes: {
          appName: config.appName,
          correlationId: "some-epic-id",
          retryCount: "0",
          runId: fakePubSub.recordedMessages()[0].attributes.runId,
          relativeUrl: "trigger/start",
          key: "trigger.start",
          origin: "cloudTasks",
        },
        deliveryAttempt: 1,
        message: { error: { message: "Failed to start trigger" } },
        topic: config.deadLetterTopic,
      });
    });
  });

  Scenario("A request is made to an unknown sequence", () => {
    let broker;
    Given("broker is initiated with a recipe", () => {
      broker = start({
        startServer: false,
        recipes: [
          {
            namespace: "sequence",
            name: "test",
            sequence: [
              route(".perform.http-step", () => {
                return { type: "testing", id: "some-epic-id" };
              }),
            ],
          },
        ],
      });
    });

    And("we can publish pubsub messages", () => {
      fakePubSub.enablePublish(broker);
    });

    And("Cloud Tasks throws an error", () => {
      sandbox.stub(CloudTasksClient.prototype).createTask = () => {
        throw new Error("Cloud Tasks error");
      };
    });

    let response;
    When("a trigger message is received", async () => {
      response = await request(broker).post("/v2/sequence/unknown").send({});
    });

    Then("the status code should be 404 not found", () => {
      response.statusCode.should.eql(404, response.text);
    });

    And("no messages should have been sent to the DLX", () => {
      fakePubSub.recordedMessages().length.should.eql(0);
    });
  });
});
