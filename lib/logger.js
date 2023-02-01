import config from "exp-config";
import pino from "pino";

function severity(label) {
  switch (label) {
    case "trace":
      return "DEBUG";
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARNING";
    case "error":
      return "ERROR";
    case "fatal":
      return "CRITICAL";
    default:
      return "DEFAULT";
  }
}

const logger = pino(
  {
    formatters: {
      level(label) {
        return { severity: severity(label) };
      },
    },
    level: config.logLevel || "info",
    timestamp: () => `, "time": "${new Date().toISOString()}"`,
    base: undefined, // to avoid pid and hostname on log rows
    messageKey: "message",
  },
  config.envName === "test" && pino.destination("logs/test.log")
);

function buildLogger(correlationId, key) {
  if (correlationId) {
    return logger.child({ correlationId, key });
  }
  return logger;
}

export default buildLogger;
