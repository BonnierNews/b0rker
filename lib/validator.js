import Joi from "joi";

export default function validate(body, schema) {
  const fullSchema = Joi.object({
    type: Joi.string().required(),
    id: Joi.string().required(),
    attributes: schema,
    data: Joi.array().optional(),
  }).unknown(true);

  const { error, value } = fullSchema.validate(body, { abortEarly: false });
  if (error) {
    const details = error.details.map((e) => e.message).join(", ");
    const err = new Error(details);
    err.validation = true;
    throw err;
  }
  return value;
}
