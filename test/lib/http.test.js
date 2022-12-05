import nock from "nock";
import http from "../../lib/http.js";
import fakeGcpAuth from "../helpers/fake-gcp-auth.js";

const baseUrl = "https://some-base.local";
const fakeApi = nock(baseUrl);

describe("http", () => {
  beforeEach(() => {
    fakeGcpAuth.enableGetRequestHeaders();
  });
  afterEach(() => {
    fakeGcpAuth.reset();
  });
  describe("google auth", () => {
    it("should append auth header", async () => {
      fakeApi.get("/some/path").matchHeader("Authorization", "Bearer some-gcp-token").reply(200, {ok: true});
      const result = await http.asserted.get({baseUrl, path: "/some/path"});
      result.should.eql({ok: true});
    });
  });
  describe("asserted", () => {
    const correlationId = "http-test-asserted";

    it("should do get-requests", async () => {
      fakeApi.get("/some/path").reply(200, {ok: true});
      const result = await http.asserted.get({baseUrl, path: "/some/path", correlationId});
      result.should.eql({ok: true});
    });

    it("should do get-requests with query-string", async () => {
      fakeApi.get("/some/path").query({q: "some-query"}).times(2).reply(200, {ok: true});
      const result = await http.asserted.get({baseUrl, path: "/some/path", correlationId, qs: {q: "some-query"}});
      result.should.eql({ok: true});

      const next = await http.asserted.get({baseUrl, path: "/some/path?q=some-query", correlationId});
      next.should.eql({ok: true});
    });

    it("should fail on 500", (done) => {
      fakeApi.get("/some/path").reply(500, {ok: false});
      http.asserted
        .get({baseUrl, path: "/some/path", correlationId})
        .then(() => done("should not come here"))
        .catch(() => done());
    });

    it("should throw on 404", (done) => {
      fakeApi.get("/some/path").reply(404, {ok: true});
      http.asserted
        .get({baseUrl, path: "/some/path", correlationId})
        .then(() => done("should not come here"))
        .catch(() => done());
    });

    it("should do delete-requests", async () => {
      fakeApi.delete("/some/path").reply(200, {ok: true});
      const result = await http.asserted.del({baseUrl, path: "/some/path", correlationId});
      result.should.eql({ok: true});
    });

    ["PATCH", "POST", "PUT"].forEach((method) => {
      it(`should do ${method}-requests`, async () => {
        fakeApi[method.toLowerCase()]("/some/path", (body) => {
          body.should.eql({correlationId});
          return true;
        }).reply(200, {ok: true});
        const result = await http.asserted[method.toLowerCase()]({
          baseUrl,
          path: "/some/path",
          correlationId,
          body: {correlationId}
        });
        result.should.eql({ok: true});
      });

      [200, 201, 204, 301, 302].forEach((code) => {
        it(`should not fail on ${code}`, async () => {
          fakeApi[method.toLowerCase()]("/some/path", (body) => {
            body.should.eql({correlationId});
            return true;
          }).reply(code, {ok: true});
          const result = await http.asserted[method.toLowerCase()]({
            baseUrl,
            path: "/some/path",
            correlationId,
            body: {correlationId}
          });
          result.should.eql({ok: true});
        });
      });

      it("should throw on 404", (done) => {
        fakeApi[method.toLowerCase()]("/some/path").reply(404, {ok: true});
        http.asserted[method.toLowerCase()]({baseUrl, path: "/some/path", correlationId})
          .then(() => done("should not come here"))
          .catch(() => done());
      });
    });
  });

  describe("with results", () => {
    const correlationId = "http-test-verbs";

    it("should do get-requests", async () => {
      fakeApi.get("/some/path").reply(200, {ok: true});
      const result = await http.get({baseUrl, path: "/some/path", correlationId});
      result.statusCode.should.eql(200);
      result.body.should.eql({ok: true});
    });

    it("should do get-requests with query-string", async () => {
      fakeApi.get("/some/path").query({q: "some-query"}).times(2).reply(200, {ok: true});
      const result = await http.get({baseUrl, path: "/some/path", correlationId, qs: {q: "some-query"}});
      result.statusCode.should.eql(200);
      result.body.should.eql({ok: true});

      const next = await http.get({baseUrl, path: "/some/path?q=some-query", correlationId});
      next.statusCode.should.eql(200);
      next.body.should.eql({ok: true});
    });

    it("should not fail on 500", async () => {
      fakeApi.get("/some/path").reply(500, {ok: false});
      const result = await http.get({baseUrl, path: "/some/path", correlationId});
      result.statusCode.should.eql(500);
      result.body.should.eql({ok: false});
    });

    it("should be 404", async () => {
      fakeApi.get("/some/path").reply(404, {ok: true});
      const result = await http.get({baseUrl, path: "/some/path", correlationId});
      result.statusCode.should.eql(404);
      result.body.should.eql({ok: true});
    });

    it("should do delete-requests", async () => {
      fakeApi.delete("/some/path").reply(200, {ok: true});
      const result = await http.del({baseUrl, path: "/some/path", correlationId});
      result.statusCode.should.eql(200);
      result.body.should.eql({ok: true});
    });

    ["PATCH", "POST", "PUT"].forEach((method) => {
      it(`should do ${method}-requests`, async () => {
        fakeApi[method.toLowerCase()]("/some/path", (body) => {
          body.should.eql({correlationId});
          return true;
        }).reply(200, {ok: true});
        const result = await http[method.toLowerCase()]({
          baseUrl,
          path: "/some/path",
          correlationId,
          body: {correlationId}
        });
        result.statusCode.should.eql(200);
        result.body.should.eql({ok: true});
      });

      it("should fail on 500", async () => {
        fakeApi[method.toLowerCase()]("/some/path").reply(500, {ok: false});
        const result = await http[method.toLowerCase()]({baseUrl, path: "/some/path", correlationId});
        result.statusCode.should.eql(500);
        result.body.should.eql({ok: false});
      });

      it("should be 404", async () => {
        fakeApi[method.toLowerCase()]("/some/path").reply(404, {ok: true});
        const result = await http[method.toLowerCase()]({baseUrl, path: "/some/path", correlationId});
        result.statusCode.should.eql(404);
        result.body.should.eql({ok: true});
      });
    });
  });

  describe("with baseUrl", () => {
    const correlationId = "http-test-with-base-url";
    it("should allow url as param", async () => {
      nock("http://other-api.example.com").get("/some/path").reply(200, {ok: true});
      const result = await http.get({baseUrl: "http://other-api.example.com", path: "/some/path", correlationId});
      result.statusCode.should.eql(200);
      result.body.should.eql({ok: true});
    });
  });
  afterEach(() => {
    nock.cleanAll();
  });
});
