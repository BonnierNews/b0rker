async function getFile(filename) {
  return await import(`./${filename}.js`);
}

export { getFile };
