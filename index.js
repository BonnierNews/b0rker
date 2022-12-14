import express from "express";
import expressPromiseRouter from "express-promise-router";
import config from "exp-config";

import recipe from "./lib/recipe-repo.js";
import buildLogger from "./lib/logger.js";
import messageHandler from "./lib/message-handler.js";
import resumeHandler from "./lib/resume-handler.js";
import buildContext from "./lib/context.js";

import fakeCloudTask from "./test/helpers/fake-cloud-task.js";
import fakePubSub from "./test/helpers/fake-pub-sub.js";
import fakeGcpAuth from "./test/helpers/fake-gcp-auth.js";
import run from "./test/helpers/run.js";
import {assertRejected, assertRetry} from "./test/helpers/assert-helpers.js";
import {buildMessage} from "./test/helpers/build-message.js";

export function route(key, fn) {
  const result = {};
  result[key] = fn;
  return result;
}

export function start({recipes, startServer = true}) {
  const router = expressPromiseRouter();
  const app = express();
  app.use(express.json());

  const recipeMap = recipe.init(recipes);

  router.get("/", (req, res) => {
    res.send("Im alive - som fan!");
  });

  router.post("/resume-message", resumeHandler);
  router.post("/message", messageHandler.bind(messageHandler, recipeMap));

  // Do something here?
  // router.get("/trigger", (req, res) => triggerHandler(req, res));

  app.use(router);

  if (startServer) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      buildLogger().info(`${config.appName}: listening on port ${port}, env ${config.envName}`);
    });
  }

  return app;
}

export const testHelpers = {
  fakeCloudTask,
  fakePubSub,
  fakeGcpAuth,
  buildMessage,
  assertRejected,
  assertRetry,
  buildContext,
  run
};
