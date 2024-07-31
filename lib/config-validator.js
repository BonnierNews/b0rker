export default function validateConfig(config) {
  const containsInvalidValues = JSON.stringify(config).includes("REPLACED_BY_ENV");

  if (containsInvalidValues) {
    const flattenedConfig = flattenObject(config);
    const invalidValues = Object.keys(flattenedConfig).filter((key) => {
      return flattenedConfig[key] === "REPLACED_BY_ENV";
    });

    if (invalidValues.length !== 0) {
      throw new Error(`Invalid config for keys: ${invalidValues.join(", ")}`);
    }

    throw new Error("Config contains invalid values");
  }
}

function flattenObject(o) {
  const result = {};
  for (const i in o) {
    if ((typeof o[i]) === "object" && !Array.isArray(o[i])) {
      const fo = flattenObject(o[i]);
      for (const j in fo) {
        result[`${i}.${j}`] = fo[j];
      }
    } else {
      result[i] = o[i];
    }
  }
  return result;
}
