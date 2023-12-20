# b0rker

A message broker for google pubsub

## Config needed

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
        route(".perform.create-invoice", createInvoice),
        route(".perform.collect-payment", collectPayment),
        route(".update.order-state--processed", orderProcessed),
      ],
    },
  ],
});
```
