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

const recipeSchema = joi
  .array()
  .unique((a, b) => a.name === b.name && a.namespace === b.namespace)
  .items(sequenceSchema);

const triggerSchema = joi.object();

function validateRecipes(recipes, schema) {
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

export function validate(recipes, triggers = {}) {
  validateRecipes(recipes, recipeSchema);
  validateTriggers(triggers);
}
