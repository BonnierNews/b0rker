import { Router as expressRouter } from "express";
import { debugMeta } from "lu-logger";

import { setAttributes } from "./attributes.js";
import { setDebugMeta } from "./debug-meta.js";
import { sendToDlxMiddleware } from "./dlx.js";
import { logMessageMiddleware, logRequest } from "./log-middleware.js";

export const router = expressRouter();

router.use(setAttributes);
router.use(setDebugMeta);
router.use(debugMeta.initMiddleware((req) => req.debugMeta));
router.use(logMessageMiddleware);
router.use(logRequest);
router.use(sendToDlxMiddleware);
