export function buildNextKeyMapper(recipes) {
  const map = new Map();

  for (const { namespace, name, sequence } of recipes) {
    const iterator = sequenceIterator(sequence);
    const fullKey = (key) => `${namespace}.${name}.${key}`;

    let prevKey = iterator.next().value[0];
    for (const [ key ] of iterator) {
      map.set(fullKey(prevKey), fullKey(key));
      prevKey = key;
    }
    map.set(fullKey(prevKey), fullKey("processed"));
  }

  return (k) => map.get(k);
}

export function* sequenceIterator(sequence) {
  for (const route of sequence) {
    const [ key, func ] = Object.entries(route)[0];
    yield [ key, func ];
  }
}

export function buildUrl(namespace, sequenceName, key) {
  return `/${namespace}/${sequenceName}/${key.replace(/^\./, "")}`;
}

export function keyToUrl(key) {
  const [ namespace, sequenceName, ...rest ] = key.replace(/^\./, "").split(".");
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
