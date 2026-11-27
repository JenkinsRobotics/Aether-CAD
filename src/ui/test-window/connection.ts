export function testWindowConnectionError(message: string, localDevelopment: boolean): string {
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return localDevelopment
      ? "The local CAD connection stopped. Start npm run dev:test-window in Aether-CAD, then retry the rebuild."
      : "The CAD server could not be reached. Check the connection, then retry the rebuild.";
  }
  return message;
}
