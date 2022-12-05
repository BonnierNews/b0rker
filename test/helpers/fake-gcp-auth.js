import sinon from "sinon";
import GoogleAuth from "google-auth-library";

const sandbox = sinon.createSandbox();

let stub;

function init() {
  if (!stub) {
    stub = sandbox.stub(GoogleAuth.GoogleAuth.prototype);
  }
}

function enableGetRequestHeaders() {
  init();
  stub.getIdTokenClient = () => {
    return {
      getRequestHeaders: () => {
        return {Authorization: "Bearer some-gcp-token"};
      }
    };
  };
}

function reset() {
  sandbox.restore();
  stub = null;
}

export default {
  enableGetRequestHeaders,
  reset
};
