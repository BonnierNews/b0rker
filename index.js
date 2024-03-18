import express from "express";
import expressPromiseRouter from "express-promise-router";
import config from "exp-config";
import assert from "assert";

import "express-async-errors";
import { init } from "./lib/recipe-repo.js";
import buildLogger from "./lib/logger.js";
import messageHandler from "./lib/message-handler.js";
import { trigger } from "./lib/trigger-handler.js";
import cloudTasksRouter from "./lib/cloud-tasks/router.js";

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

  // use PubSubs message size limit
  app.use(express.json({ limit: "32mb" }));

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

  router.post("/message", messageHandler.bind(messageHandler, recipeMap));
  router.post("/trigger/:namespace/:sequence", trigger.bind(trigger, recipeMap));
  router.post("/trigger/:name", trigger.bind(trigger, recipeMap));

  app.use(router);
  app.use("/v2", cloudTasksRouter(recipes, triggers));

  /* c8 ignore start */
  if (startServer) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      buildLogger().info(`${config.appName}: listening on port ${port}, env ${config.envName}`);
    });
  }
  /* c8 ignore stop */

  return app;
}
