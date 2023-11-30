import nock from "nock";
import { fakeGcpAuth } from "@bonniernews/lu-test";
import config from "exp-config";
import { Readable } from "stream";

import http from "../../lib/http.js";

const fakeApi = nock(config.gcpProxy.url);
const fakeApiOld = nock(config.proxyUrl);

describe("http", () => {
  beforeEach(() => {
    fakeGcpAuth.authenticated();
  });
  afterEach(() => {
    fakeGcpAuth.reset();
  });
  describe("google auth livesInGcp", () => {
    it("should append auth header", async () => {
      fakeApi.get("/some/path").matchHeader("Authorization", "Bearer some-gcp-token").reply(200, { ok: true });
      const result = await http.asserted.get({ path: "/some/path" });
      result.should.eql({ ok: true });
    });
  });
  describe("x-throttle", () => {
    it("should append x-throttle header", async () => {
      fakeApi.get("/some/path").matchHeader("x-throttle", "yes").reply(200, { ok: true });
      const result = await http.asserted.get({ path: "/some/path" });
      result.should.eql({ ok: true });
    });
  });
  describe("google auth other base url with audience", () => {
    it("should append auth header", async () => {
      fakeApiOld.get("/not-some/path").matchHeader("Authorization", "Bearer some-gcp-token").reply(200, { ok: true });
      const result = await http.asserted.get({ baseUrl: config.proxyUrl, path: "/not-some/path", audience: "some-audience" });
      result.should.eql({ ok: true });
    });
  });
  describe("no google auth other base url without audience", () => {
    it("should append auth header", async () => {
      fakeApiOld.get("/not-some/path").reply(200, { ok: true });
      const result = await http.asserted.get({ baseUrl: config.proxyUrl, path: "/not-some/path" });
      result.should.eql({ ok: true });
    });
  });
  describe("asserted", () => {
    const correlationId = "http-test-asserted";

    it("should do get-requests", async () => {
      fakeApi.get("/some/path").reply(200, { ok: true });
      const result = await http.asserted.get({ path: "/some/path", correlationId });
      result.should.eql({ ok: true });
    });

    it("should do get-requests with query-string", async () => {
      fakeApi.get("/some/path").query({ q: "some-query" }).times(2).reply(200, { ok: true });
      const result = await http.asserted.get({ path: "/some/path", correlationId, qs: { q: "some-query" } });
      result.should.eql({ ok: true });

      const next = await http.asserted.get({ path: "/some/path?q=some-query", correlationId });
      next.should.eql({ ok: true });
    });

    it("should do stream get-requests", async () => {
      const content = "some content\nsome other content\n";
      fakeApi.get("/some/path").reply(200, Readable.from([ content ]));
      const result = await http.asserted.get({ path: "/some/path", responseType: "stream", correlationId });
      result.should.be.instanceOf(Readable);
      const chunks = [];
      for await (const chunk of result) {
        chunks.push(Buffer.from(chunk));
      }
      Buffer.concat(chunks).toString("utf-8").should.eql(content);
    });

    it("should fail on 500", (done) => {
      fakeApi.get("/some/path").reply(500, { ok: false });
      http.asserted
        .get({ path: "/some/path", correlationId })
        .then(() => done("should not come here"))
        .catch(() => done());
    });

    it("should throw on 404", (done) => {
      fakeApi.get("/some/path").reply(404, { ok: true });
      http.asserted
        .get({ path: "/some/path", correlationId })
        .then(() => done("should not come here"))
        .catch(() => done());
    });

    it("should do delete-requests", async () => {
      fakeApi.delete("/some/path").reply(200, { ok: true });
      const result = await http.asserted.del({ path: "/some/path", correlationId });
      result.should.eql({ ok: true });
    });

    [ "PATCH", "POST", "PUT" ].forEach((method) => {
      it(`should do ${method}-requests`, async () => {
        fakeApi[method.toLowerCase()]("/some/path", (body) => {
          body.should.eql({ correlationId });
          return true;
        }).reply(200, { ok: true });
        const result = await http.asserted[method.toLowerCase()]({

          path: "/some/path",
          correlationId,
          body: { correlationId },
        });
        result.should.eql({ ok: true });
      });

      [ 200, 201, 204, 301, 302 ].forEach((code) => {
        it(`should not fail on ${code}`, async () => {
          fakeApi[method.toLowerCase()]("/some/path", (body) => {
            body.should.eql({ correlationId });
            return true;
          }).reply(code, { ok: true });
          const result = await http.asserted[method.toLowerCase()]({

            path: "/some/path",
            correlationId,
            body: { correlationId },
          });
          result.should.eql({ ok: true });
        });
      });

      it("should throw on 404", (done) => {
        fakeApi[method.toLowerCase()]("/some/path").reply(404, { ok: true });
        http.asserted[method.toLowerCase()]({ path: "/some/path", correlationId })
          .then(() => done("should not come here"))
          .catch(() => done());
      });
    });
  });

  describe("with results", () => {
    const correlationId = "http-test-verbs";

    it("should do get-requests", async () => {
      fakeApi.get("/some/path").reply(200, { ok: true });
      const result = await http.get({ path: "/some/path", correlationId });
      result.statusCode.should.eql(200);
      result.body.should.eql({ ok: true });
    });

    it("should do get-requests with query-string", async () => {
      fakeApi.get("/some/path").query({ q: "some-query" }).times(2).reply(200, { ok: true });
      const result = await http.get({ path: "/some/path", correlationId, qs: { q: "some-query" } });
      result.statusCode.should.eql(200);
      result.body.should.eql({ ok: true });

      const next = await http.get({ path: "/some/path?q=some-query", correlationId });
      next.statusCode.should.eql(200);
      next.body.should.eql({ ok: true });
    });

    it("should do stream get-requests", async () => {
      const content = "some content\nsome other content\n";
      fakeApi.get("/some/path").reply(200, Readable.from([ content ]));
      const result = await http.get({ path: "/some/path", responseType: "stream", correlationId });
      result.statusCode.should.eql(200);
      result.body.should.be.instanceOf(Readable);
      const chunks = [];
      for await (const chunk of result.body) {
        chunks.push(Buffer.from(chunk));
      }
      Buffer.concat(chunks).toString("utf-8").should.eql(content);
    });

    it("should do stream post-requests", async () => {
      const content = "some content\nsome other content\n";
      fakeApi.post("/some/path").reply(200, { ok: true });
      const result = await http.post({
        path: "/some/path",
        body: Readable.from([ content ]),
        correlationId,
      });
      result.statusCode.should.eql(200);
      result.body.should.eql({ ok: true });
    });

    it("should not fail on 500", async () => {
      fakeApi.get("/some/path").reply(500, { ok: false });
      const result = await http.get({ path: "/some/path", correlationId });
      result.statusCode.should.eql(500);
      result.body.should.eql({ ok: false });
    });

    it("should be 404", async () => {
      fakeApi.get("/some/path").reply(404, { ok: true });
      const result = await http.get({ path: "/some/path", correlationId });
      result.statusCode.should.eql(404);
      result.body.should.eql({ ok: true });
    });

    it("should do delete-requests", async () => {
      fakeApi.delete("/some/path").reply(200, { ok: true });
      const result = await http.del({ path: "/some/path", correlationId });
      result.statusCode.should.eql(200);
      result.body.should.eql({ ok: true });
    });

    [ "PATCH", "POST", "PUT" ].forEach((method) => {
      it(`should do ${method}-requests`, async () => {
        fakeApi[method.toLowerCase()]("/some/path", (body) => {
          body.should.eql({ correlationId });
          return true;
        }).reply(200, { ok: true });
        const result = await http[method.toLowerCase()]({

          path: "/some/path",
          correlationId,
          body: { correlationId },
        });
        result.statusCode.should.eql(200);
        result.body.should.eql({ ok: true });
      });

      it("should fail on 500", async () => {
        fakeApi[method.toLowerCase()]("/some/path").reply(500, { ok: false });
        const result = await http[method.toLowerCase()]({ path: "/some/path", correlationId });
        result.statusCode.should.eql(500);
        result.body.should.eql({ ok: false });
      });

      it("should be 404", async () => {
        fakeApi[method.toLowerCase()]("/some/path").reply(404, { ok: true });
        const result = await http[method.toLowerCase()]({ path: "/some/path", correlationId });
        result.statusCode.should.eql(404);
        result.body.should.eql({ ok: true });
      });
    });
  });

  describe("with baseUrl", () => {
    const correlationId = "http-test-with-base-url";
    it("should allow url as param", async () => {
      nock("http://other-api.example.com").get("/some/path").reply(200, { ok: true });
      const result = await http.get({ baseUrl: "http://other-api.example.com", path: "/some/path", correlationId });
      result.statusCode.should.eql(200);
      result.body.should.eql({ ok: true });
    });
  });
  afterEach(() => {
    nock.cleanAll();
  });
});
