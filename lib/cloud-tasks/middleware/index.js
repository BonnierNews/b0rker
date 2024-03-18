import { Router as expressRouter } from "express";
import luLogger from "lu-logger";

import { setAttributes } from "./attributes.js";
import { setDebugMeta } from "./debug-meta.js";
import { logMessageMiddleware } from "./log-middleware.js";
import { sendToDlxMiddleware } from "./dlx.js";

export const router = expressRouter();

router.use(setAttributes);
router.use(setDebugMeta);
router.use(luLogger.debugMeta.initMiddleware((req) => req.debugMeta));
router.use(logMessageMiddleware);
router.use(sendToDlxMiddleware);
