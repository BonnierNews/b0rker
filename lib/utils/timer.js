export default async function setTimer(delaySeconds) {
  return await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}
