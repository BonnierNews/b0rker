import http from "./http.js";

function partial(fn, meta) {
  return (context) => fn({...meta, ...context});
}

export default function client(correlationId, key) {
  const result = {asserted: {}};
  Object.keys(http).forEach((k) => {
    result[k] = partial(http[k], {correlationId, key});
  });
  Object.keys(http.asserted).forEach((k) => {
    result.asserted[k] = partial(http.asserted[k], {correlationId, key});
  });

  return result;
}
