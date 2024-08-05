function parseUrl(baseUrl, path) {
  const baseUrlWithProtocol = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const baseUrlWithoutEndSlash = baseUrlWithProtocol.endsWith("/")
    ? baseUrlWithProtocol.slice(0, -1)
    : baseUrlWithProtocol;
  const url = new URL(`${baseUrlWithoutEndSlash}${path}`);
  return url.href;
}

export default parseUrl;
