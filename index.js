import express from "express";
import expressPromiseRouter from "express-promise-router";
import config from "exp-config";
import assert from "assert";

import { init } from "./lib/recipe-repo.js";
import buildLogger from "./lib/logger.js";
import messageHandler from "./lib/message-handler.js";
import resumeHandler from "./lib/resume-handler.js";
import { trigger, triggerBulk } from "./lib/trigger-handler.js";

export { default as buildContext } from "./lib/context.js";

export function route(key, fn) {
  const result = {};
  result[key] = fn;
  return result;
}

export function start({ recipes, triggers, startServer = true }) {

  assert(config.appName, "appName must be set in config");

  const router = expressPromiseRouter();
  const app = express();
  app.use(express.json());

  const recipeMap = init(recipes, triggers);

  router.use((req, _, next) => {
    // middleware to handle requests via a proxy
    if (config.appName?.length && req.url.startsWith(`/${config.appName}`)) {
      req.url = req.url.replace(`/${config.appName}`, "");
    }
    next();
  });

  router.get("/", (req, res) => {
    res.send("Im alive - som fan!");
  });

  router.post("/resume-message", resumeHandler);
  router.post("/message", messageHandler.bind(messageHandler, recipeMap));
  router.post("/trigger/bulk/:namespace/:sequence", triggerBulk.bind(triggerBulk, recipeMap));
  router.post("/trigger/bulk/:name", triggerBulk.bind(triggerBulk, recipeMap));
  router.post("/trigger/:namespace/:sequence", trigger.bind(trigger, recipeMap));
  router.post("/trigger/:name", trigger.bind(trigger, recipeMap));

  app.use(router);

  if (startServer) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      buildLogger().info(`${config.appName}: listening on port ${port}, env ${config.envName}`);
    });
  }

  return app;
}
