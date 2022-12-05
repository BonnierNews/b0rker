import request from "supertest";
import * as app from "../../index.js";

export function post(path, payload) {
  return request(app)
    .post(path)
    .set("Content-Type", "application/json")
    .send(payload)
    .expect("Content-Type", new RegExp("application/json"));
}
export function get(path) {
  return request(app)
    .get(path)
    .set("Content-Type", "application/json")
    .expect("Content-Type", new RegExp("application/json"));
}
