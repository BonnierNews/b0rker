import express from "express";
import expressPromiseRouter from "express-promise-router";
import config from "exp-config";
import assert from "assert";

import "express-async-errors";
import { validate } from "./lib/recipe-repo.js";
import buildLogger from "./lib/logger.js";
import cloudTasksRouter from "./lib/router.js";

export { default as buildContext } from "./lib/context.js";

export function route(key, fn, { queue } = {}) {
  if (fn) fn.queue = queue; // Ugly hack to pass the queue along to the cloud tasks router, remove when removing pubsub support
  return { [key]: fn };
}

export function start({ recipes, triggers, startServer = true }) {
  assert(config.appName, "appName must be set in config");

  const router = expressPromiseRouter();
  const app = express();

  // use PubSubs message size limit
  app.use(express.json({ limit: "32mb" }));

  validate(recipes, triggers);

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

  router.get("/_status", (req, res) => {
    res.send({ status: "ok" });
  });

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
