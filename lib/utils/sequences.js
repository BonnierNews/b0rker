export function buildNextKeyMapper(recipes) {
  const map = new Map();

  for (const { namespace, name, sequence } of recipes) {
    const iterator = sequenceIterator(sequence);
    const fullKey = (key) => `${namespace}.${name}.${key}`;

    let prevKey = iterator.next().value.key;
    for (const { key, queue } of iterator) {
      map.set(fullKey(prevKey), { nextKey: fullKey(key), queue });
      prevKey = key;
    }
    map.set(fullKey(prevKey), { nextKey: fullKey("processed") });
  }

  return (k) => map.get(k);
}

export function* sequenceIterator(sequence) {
  for (const route of sequence) {
    const [ key, func ] = Object.entries(route)[0];
    yield { key, func, queue: func.queue };
  }
}

export function buildUrl(...parts) {
  return `/${parts.filter(Boolean).map((s) => s.replace(/^\./, "")).join("/")}`;
}

export function keyToUrl(key) {
  const parts = key.split(".").filter(Boolean);
  const [ namespace, sequenceName, ...rest ] = parts;
  return buildUrl(namespace, sequenceName, rest.join("."));
}

export function appendData(prevMessage, result) {
  const newData = [ ...(prevMessage.data || []) ];
  if (result && !result.key) {
    if (Array.isArray(result)) {
      newData.push(...result);
    } else {
      newData.push(result);
    }
  }
  return { ...prevMessage, data: newData };
}

export function filterUndefinedNullValues(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([ , value ]) => value !== undefined && value !== null)
  );
}
