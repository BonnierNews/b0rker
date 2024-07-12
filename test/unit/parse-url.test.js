import parseUrl from "../../lib/utils/parse-url.js";

describe("parseUrl", () => {
  it("should parse URL when protocol set", () => {
    const baseUrl = "http://www.some-non-secure-site.com";
    const path = "/";
    const result = parseUrl(baseUrl, path);
    result.should.eql("http://www.some-non-secure-site.com/");
  });

  it("should parse URL with default protocol when protocol NOT set", () => {
    const baseUrl = "www.hyatt.com";
    const path = "/";
    const result = parseUrl(baseUrl, path);
    result.should.eql("https://www.hyatt.com/");
  });

  it("should parse URL when protocol set BUT has end slash", () => {
    const baseUrl = "https://www.hyatt.com/";
    const path = "/";
    const result = parseUrl(baseUrl, path);
    result.should.eql("https://www.hyatt.com/");
  });
});
