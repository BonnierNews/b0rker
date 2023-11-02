import config from "exp-config";
import { pushClient, cloudRunResourceProvider } from "@bonniernews/gcp-push-metrics";

import buildLogger from "./logger.js";

const client = pushClient({ logger: buildLogger(), resourceProvider: cloudRunResourceProvider });
const { appName } = config;

const labels = {
  bnNamespace: [],
  appName: [],
  path: [],
};

export default {
  messages: client.counter({
    name: `lu_${appName}_messages`,
    ...labels,
  }),
  rejectedMessages: client.counter({
    name: `lu_${appName}_rejected`,
    ...labels,
  }),
  retriedMessages: client.counter({
    name: `lu_${appName}_retried`,
    ...labels,
  }),
  unrecoverableMessages: client.counter({
    name: `lu_${appName}_unrecoverable`,
    ...labels,
  }),
  processedSequences: client.counter({
    name: `lu_${appName}_processed`,
    ...labels,
  }),
};
