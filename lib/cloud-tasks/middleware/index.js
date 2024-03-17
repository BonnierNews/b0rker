import { Router as expressRouter } from "express";
import luLogger from "lu-logger";

import { setCorrelationId, setDebugMeta } from "./debug-meta.js";
import { logMessageMiddleware } from "./log-middleware.js";
import { errorHandler } from "./error-handler.js";

export const router = expressRouter();

router.use(setCorrelationId);
router.use(setDebugMeta);
router.use(luLogger.debugMeta.initMiddleware((req) => req.debugMeta));
router.use(logMessageMiddleware);
router.use(errorHandler);
