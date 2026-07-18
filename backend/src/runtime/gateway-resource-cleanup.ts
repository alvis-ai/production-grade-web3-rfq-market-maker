export async function closeGatewayResources(
  closers: readonly (() => void | Promise<void>)[],
): Promise<void> {
  let firstError: unknown;
  let failed = false;
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}
