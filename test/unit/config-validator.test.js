import { expect } from "chai";

import validateConfig from "../../lib/config-validator.js";

describe("Config validator", () => {
  it("should not return anything", () => {
    const config = {
      envName: "test",
      logClientIp: true,
      express: { body: { limit: "200kb" } },
    };
    should.not.exist(validateConfig(config));
  });

  it("should throw error", () => {
    const config = {
      envName: "test",
      logClientIp: true,
      express: { body: { limit: "REPLACED_BY_ENV" } },
    };
    expect(() => validateConfig(config)).to.throw("Invalid config for keys: express.body.limit");
  });

  it("should throw error", () => {
    const config = {
      envName: "test",
      logClientIp: true,
      express: { body: { limit: "200kb" } },
      items: [
        { name: "REPLACED_BY_ENV" },
        {
          name: "yello",
          value: "REPLACED_BY_ENV",
        },
      ],
    };
    expect(() => validateConfig(config)).to.throw("Config contains invalid values");
  });

  it("should throw error", () => {
    const config = {
      envName: "test",
      logClientIp: "REPLACED_BY_ENV",
      express: { body: { limit: "REPLACED_BY_ENV" } },
    };
    expect(() => validateConfig(config)).to.throw("Invalid config for keys: logClientIp, express.body.limit");
  });
});
