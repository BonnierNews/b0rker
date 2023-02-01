import joi from "joi";

const allowedVerbs = [
  "get-or-create",
  "get",
  "update",
  "upsert",
  "delete",
  "validate",
  "perform",
  "trigger-sub-sequence",
];

const sequenceSchema = joi.object().keys({
  namespace: joi.string().valid("event", "action", "sequence", "sub-sequence").required(),
  name: joi
    .string()
    .regex(/^[a-z0-9][-a-z0-9.]*$/)
    .required(),
  sequence: joi
    .array()
    .unique((a, b) => Object.keys(a)[0] === Object.keys(b)[0])
    .required()
    .items(joi.object().length(1)),
  executionDelay: joi.alternatives().conditional("namespace", {
    is: "sub-sequence",
    then: joi
      .number()
      .min(0)
      .max(60 * 60 * 1000),
  }),
  unrecoverable: joi.array().items(joi.object().length(1)),
  useParentCorrelationId: joi.boolean().default(false),
});

const recipeShema = joi
  .array()
  .unique((a, b) => a.name === b.name && a.namespace === b.namespace)
  .items(sequenceSchema);

const triggerSchema = joi.object();

function validate(recipes, schema) {
  const { error } = schema.validate(recipes);
  if (error) {
    const message = error.details.map((d) => `value: ${JSON.stringify(d.context.value)} detail: ${d.message}`);
    error.message = message.join(", ");
    throw error;
  }
  recipes.forEach(validateSequenceFormat);
  recipes.forEach(validateUnrecoverable);
}

function validateTriggers(triggers) {
  const { error } = triggerSchema.validate(triggers);
  if (error) {
    const message = error.details.map((d) => `value: ${JSON.stringify(d.context.value)} detail: ${d.message}`);
    error.message = message.join(", ");
    throw error;
  }
  Object.entries(triggers).forEach(([ key, value ]) => {
    const pattern = /^trigger\.[a-z0-9-]+$/;
    if (!key.match(pattern)) {
      throw new Error(`Invalid format for ${key}, allowed are ${pattern}`);
    }
    if (typeof value !== "function") {
      throw new Error(`Only functions are supported as triggers (given '${value}')`);
    }
  });
}

function validateSequenceFormat(recipe) {
  recipe.sequence.forEach((step) => {
    const [ key ] = Object.keys(step);
    const parts = key.split(".").filter(Boolean);
    if (!key.startsWith(".")) {
      parts.splice(0, 2); // remove namespace, name
    }
    if (parts[0] === "optional") {
      parts.shift(); // remove optional
    }
    if (parts.length !== 2) throw new Error(`Invalid step ${key} in ${recipe.namespace}.${recipe.name}`);
    if (!allowedVerbs.includes(parts[0])) {
      throw new Error(
        `Invalid verb in ${key} in ${recipe.namespace}.${recipe.name}, allowed are ${allowedVerbs.join(", ")}`
      );
    }
  });
}

function validateUnrecoverable(recipe) {
  if (!recipe.unrecoverable) return;

  const [ key ] = Object.keys(recipe.unrecoverable[0]);
  if (key !== "*") {
    throw new Error(`Invalid key in unrecoverable: ${key} in ${recipe.namespace}.${recipe.name}, allowed are '*'`);
  }
}

function validateBorrowsExists(lambdaMap, borrowedKeys) {
  Object.entries(borrowedKeys).forEach(([ borrowed, key ]) => {
    if (!lambdaMap[key]) {
      const causingEvent = borrowed.split(".").slice(0, 2).join(".");
      const given = key.split(".").slice(0, 2).join(".");
      throw new Error(`Error in '${causingEvent}': borrowed key '${key}' does not exist in '${given}'`);
    }
  });
}

export function init(recipes, triggers = {}) {
  validate(recipes, recipeShema);
  validateTriggers(triggers);
  const recipeMap = {};
  const firstMap = {};
  const lambdaMap = {};
  const borrowedKeys = {};
  const triggerKeys = Object.keys(triggers).concat(recipes.map((r) => `trigger.${r.namespace}.${r.name}`));
  const unrecoverableMap = {};
  const executionDelays = {};

  for (const recipe of Object.keys(triggers).concat(recipes)) {
    if (recipe.namespace === "sub-sequence") {
      executionDelays[`trigger.${recipe.namespace}.${recipe.name}`] = recipe.executionDelay;
    }
  }

  const useParentCorrelationIdMap = {};
  recipes.forEach((r) => (useParentCorrelationIdMap[`trigger.${r.namespace}.${r.name}`] = r.useParentCorrelationId));

  recipes.forEach((recipe) => {
    const prefix = `${recipe.namespace}.${recipe.name}`;
    recipe.sequence.forEach((step, idx) => {
      const [ key ] = Object.keys(step);
      const [ next ] = recipe.sequence[idx + 1] ? Object.keys(recipe.sequence[idx + 1]) : [ ".processed" ];
      recipeMap[`${prefix}${prependPeriod(key)}`] = `${prefix}${prependPeriod(next)}`;
    });

    if (recipe.sequence[0]) {
      const [ key ] = Object.keys(recipe.sequence[0]);
      firstMap[prefix] = `${prefix}${prependPeriod(key)}`;
    }
  });

  recipes.forEach((recipe) => {
    const prefix = `${recipe.namespace}.${recipe.name}`;
    recipe.sequence.forEach((step) => {
      const [ key, fn ] = Object.entries(step)[0];
      if (key.startsWith(".")) {
        if (!fn) throw new Error(`No function given for key '${key}' in '${prefix}'`);
        if (typeof fn !== "function") {
          throw new Error(`Only functions are supported as handlers (key '${key}' in '${prefix}')`);
        }
        lambdaMap[`${prefix}${key}`] = fn;
        if (recipe.unrecoverable) {
          unrecoverableMap[`${prefix}${key}`] = recipe.unrecoverable[0]["*"];
        }
      } else {
        if (fn) throw new Error(`Handler function not allowed for borrowed key: '${key}' in '${prefix}'`);
        borrowedKeys[`${prefix}.${key}`] = key;
        if (recipe.unrecoverable) {
          unrecoverableMap[`${prefix}.${key}`] = recipe.unrecoverable[0]["*"];
        }
      }
    });
  });

  validateBorrowsExists(lambdaMap, borrowedKeys);

  return {
    first: (namespace, name) => firstMap[`${namespace}.${name}`],
    next: (replyKey) => recipeMap[replyKey],
    keys: () => recipes.map((r) => `${r.namespace}.${r.name}.#`),
    processedKeys: () => recipes.map((r) => `${r.namespace}.${r.name}.processed`),
    processedUnrecoverableKeys: () => Object.keys(unrecoverableMap).map((k) => `${k}.unrecoverable.processed`),
    triggerKeys: () => triggerKeys,
    triggerHandler: (routingKey) => triggers[routingKey],
    executionDelay: (routingKey) => executionDelays[routingKey],
    genericTriggerUsesParentCorrelationId: (routingKey) => useParentCorrelationIdMap[routingKey],
    unrecoverableHandler: (routingKey) => unrecoverableMap[routingKey],
    handler: (routingKey) => {
      return lambdaMap[routingKey] || (borrowedKeys[routingKey] && lambdaMap[borrowedKeys[routingKey]]);
    },
  };
}

function prependPeriod(key) {
  if (key.startsWith(".")) return key;
  return `.${key}`;
}

export default { init };
