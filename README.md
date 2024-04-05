# b0rker

A message broker based on Google [Cloud Tasks](https://cloud.google.com/tasks/docs) (or [PubSub](https://cloud.google.com/pubsub/docs)).

## Features

`b0rker` is a framework for running sequences small functions (also known as lambdas) to perform complex and sensitive tasks, such as collecting payments.
Each lambda should perform a single state change, and should be idempotent (and ideally, atomic, as neither Cloud Tasks nor PubSub (push) can guarantee exactly-once delivery).

### Queue routing and concurrency/rate limits

Cloud Tasks supports setting [rate and concurrency limits on a per-queue basis](https://cloud.google.com/tasks/docs/configuring-queues#rate), which can be used to control the message flow.
If multiple queues are set up, each lambda can be routed to a specific queue, meaning that task will run with the rate/concurrency limits set for that queue, but all others will run with on the default queue.
One use case is for tasks that make API calls to a rate limited third-party service, or to not overwhelm a database.

## Config needed

Can be either set with config as below or with environment variables when invoking the application.

| Option                    | Description                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| cloudTasks_queues_default | name of the default Cloud Tasks queue, in the format `projects/<project name>/locations/<location>/queues/<queue name>` |
| cloudTasks_selfUrl        | URL to the application itself                                                                                           |
| cloudTasks_localPort      | Only used when running local Cloud Tasks Emulator                                                                       |
| jobStorage                | could be either `memory` or `firestore`                                                                                 |
| deadLetterTopic           | name of the dead letter topic (PubSub is still used to deliver DLX messages)                                            |

```json
{
  "cloudTasks": {
    "selfUrl": "https://b0rker.bn.nr",
    "queues": {
      "default": "projects/project-id/locations/location/queues/foo-queue"
    }
  },
  "jobStorage": "memory",
  "topic": "topic",
  "deadLetterTopic": "dead-letter-topic"
}
```

If rate/concurrency limited queues are needed, these can be added under `cloudTasks.queues`:

```json
{
  "cloudTasks": {
    "selfUrl": "https://b0rker.bn.nr",
    "queues": {
      "default": "projects/project-id/locations/location/queues/foo-queue",
      "concurrencyLimited": "projects/project-id/locations/location/queues/bar-queue",
      "rateLimited": "projects/project-id/locations/location/queues/baz-queue"
    }
  },
  "jobStorage": "memory",
  "topic": "topic",
  "deadLetterTopic": "dead-letter-topic"
}
```

Note that the `default` queue is always required.

## Config needed (PubSub legacy)

Can be either set with config as below or with environment variables when invoking the application.

| Option          | Description                             |
| --------------- | --------------------------------------- |
| jobStorage      | could be either `memory` or `firestore` |
| topic           | name of the topic                       |
| deadLetterTopic | name of the dead letter topic           |

### Example: ./config/$NODE_ENV.json

```json
{
  "jobStorage": "memory",
  "topic": "topic",
  "deadLetterTopic": "dead-letter-topic"
}
```

## Example usage

```js
import { start, route } from "b0rker";

import getOrder from "./lib/lambdas/get-order.js";
import { orderProcessing, orderProcessed } from "./lib/lambdas/order-state.js";
import createInvoice from "./lib/lambdas/create-invoice.js";
import collectPayment from "./lib/lambdas/collect-payment.js";

start({
  recipes: [
    {
      namespace: "sequence",
      name: "process-order",
      sequence: [
        route(".get.order", getOrder),
        route(".update.order-state--processing", orderProcessing),
        route(".perform.create-invoice", createInvoice, { queue: "concurrencyLimited" }),
        route(".perform.collect-payment", collectPayment),
        route(".update.order-state--processed", orderProcessed),
      ],
    },
  ],
});
```

## Flowchart

Running a sequence from start to finish can be roughly described by the following flowchart:

```mermaid
  graph TD
      start["Start sequence"] --> publish(["Publish first message"])
      publish --> receiveMessage["Receive message"]
      receiveMessage --> sendToDlx{{"Too many retries?"}}
      sendToDlx -- No --> lambda((("Run lambda")))
      sendToDlx -- Yes --> dlx[/"Send to DLX"/]
      lambda -- Success --> triggers{{"Any triggers in response?"}}
      lambda -- Unhandled error --> nack["Nack message and retry"]
      lambda -- Retry --> nack["Nack message and retry"]
      lambda -- Reject --> dlx
      lambda -- Unrecoverable --> hasUnrecoverableHandler{{"Is there an unrecoverable handler?"}}
      nack -- Exponential backoff --> receiveMessage
      triggers -- No --> hasNextMessage{{"Is there a next message?"}}
      triggers -- Sequence --> triggerMainSequence(["Publish main sequence trigger message"])
      triggerMainSequence -. Trigger another sequence .-> start
      triggers -- Subsequence --> publishSub(["Bulk publish subsequence trigger messages"])
      triggerMainSequence --> hasNextMessage
      publishSub -. Trigger N subsequences .-> start
      unrecoverable --> processed(["Publish #quot;processed#quot; message"])
      hasNextMessage -- No --> processed
      hasNextMessage -- Yes --> publishNext(["Publish next message"])
      publishNext --> receiveMessage["Receive message"]
      hasUnrecoverableHandler -- Yes --> unrecoverable((("Run handler")))
      processed --> subSeqProcessed{{"Is it a subsequence?"}}
      subSeqProcessed -- No --> finishedMain[/"Sequence is finished"/]
      subSeqProcessed -- Yes --> subSeqLastCheck{{"Is it the last subsequence?"}}
      subSeqLastCheck -- Yes --> publishResumeMainSeq(["Publish resume main sequence message"])
      subSeqLastCheck -- No --> finishedSub[/"Subsequence is finished"/]
      publishResumeMainSeq --> receiveMessage
      publishResumeMainSeq --> finishedSub
```
