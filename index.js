import express from "express";
import expressPromiseRouter from "express-promise-router";
import config from "exp-config";

import recipe from "./lib/recipe-repo.js";
import buildLogger from "./lib/logger.js";
import messageHandler from "./lib/message-handler.js";
import resumeHandler from "./lib/resume-handler.js";
import triggerHandler from "./lib/trigger-handler.js";

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
  router.post("/trigger/:namespace/:sequence", triggerHandler.bind(triggerHandler, recipeMap));

  app.use(router);

  if (startServer) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      buildLogger().info(`${config.appName}: listening on port ${port}, env ${config.envName}`);
    });
  }

  return app;
}
