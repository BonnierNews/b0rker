import config from "exp-config";

const { toggle: configToggles = {} } = config;

/* c8 ignore start */
export default function toggle(name) {
  if (process.env.NODE_ENV === "test") {
    if (process.env["NODE-DISABLE-TOGGLE"]?.split(",")?.includes(name)) return false;
    return true;
  }
  const value = configToggles[name];
  return value === true || value === "true";
}
/* c8 ignore stop */
