/**
 * Maximum time a command stays actionable after creation.
 *
 * If the target device doesn't execute a command within this window,
 * the command is considered expired. The server times out its
 * `waitForCommandResult` promise, and the device skips stale commands
 * on wake.
 */
export const COMMAND_TTL_MS = 30_000;
