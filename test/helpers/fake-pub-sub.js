import sinon from "sinon";
import {PubSub} from "@google-cloud/pubsub";
import request from "supertest";
import config from "exp-config";

const sandbox = sinon.createSandbox();

let stub;
let messages = [];
let messageHandlerResponses = [];

function init() {
  if (!stub) {
    stub = sandbox.stub(PubSub.prototype);
  }
}

function enablePublish(broker) {
  init();
  stub.topic = (topic) => {
    return {
      publishMessage: async (message) => {
        messages.push({
          topic,
          message: message.json,
          attributes: message.attributes
        });
        if (topic !== config.deadLetterTopic) {
          const messageHandlerRes = await publish(broker, message.json, message.attributes);
          messageHandlerResponses.push(messageHandlerRes);
          return "some-message-id";
        }
      }
    };
  };
}

async function triggerMessage(broker, messageData, attributes) {
  return await publish(broker, messageData, attributes);
}

async function publish(app, messageData, attributes) {
  const data = Buffer.isBuffer(messageData) ? JSON.parse(messageData.toString("utf-8")) : messageData;
  const message = {
    message: {
      attributes,
      data: Buffer.from(JSON.stringify(data)).toString("base64"),
      messageId: "some-id",
      publishTime: "123"
    },
    subscription: "some-cool-subscription"
  };
  return await request(app).post("/message").send(message);
}

function reset() {
  messages = [];
  messageHandlerResponses = [];
  sandbox.restore();
  stub = null;
}

export default {
  enablePublish,
  reset,
  recordedMessages: () => {
    return messages;
  },
  recordedMessageHandlerResponses: () => {
    return messageHandlerResponses;
  },
  triggerMessage
};
