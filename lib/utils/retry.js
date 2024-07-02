import { logger } from "lu-logger";

import setTimer from "./timer.js";

export default async function withRetries(func, { maxRetries = 5, initialDelay = 1 }) {
  for (let retries = 0; retries <= maxRetries; retries++) {
    try {
      return await func();
    } catch (err) {
      if (retries >= maxRetries) {
        throw err;
      }
      logger.warning(`Retrying after error: ${err.message}: ${err.stack}`);
      await setTimer(initialDelay * 2 ** retries);
    }
  }
}
