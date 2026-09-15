import { rm } from "node:fs/promises";

/**
 * Deletes a test's temp directory. On Windows libSQL keeps a closed database
 * file locked for several seconds, so a plain `rm` fails with EBUSY; Node's own
 * retry waits it out, and vitest.config.mts gives hooks the time to do so.
 */
export const removeTempDir = (dir: string) =>
  rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
