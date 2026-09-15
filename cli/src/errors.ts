/** Exit status for every failure without a more specific one. */
export const EXIT_FAILURE = 1;
/** Exit status when there is no usable token, as gh uses it: log in again. */
export const EXIT_AUTH = 4;

/** A failure meant for the user: index.ts prints the message and exits. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = EXIT_FAILURE) {
    super(message);
    this.exitCode = exitCode;
  }
}

export const notLoggedIn = (server: string) =>
  new CliError(`Not logged in to ${server}. Run: ai-tutor login`, EXIT_AUTH);

export const tokenRejected = (server: string) =>
  new CliError(
    `${server} no longer accepts the stored token (it was revoked or has expired). Run: ai-tutor login`,
    EXIT_AUTH,
  );

/**
 * Runs one request, turning the `TypeError` fetch throws when nothing answers
 * into a message that names the server and the way to point elsewhere.
 */
export async function reach<T>(
  server: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    const cause = error.cause instanceof Error ? error.cause.message : "";
    throw new CliError(
      `Could not reach ${server}${cause ? ` (${cause})` : ""}. Start the web app, or set AI_TUTOR_URL to a running one.`,
    );
  }
}

/** The most useful text in a Better Auth or OAuth error body. */
export function describe(error: unknown): string {
  const body = (error ?? {}) as {
    error_description?: string;
    message?: string;
    error?: string;
    status?: number;
  };
  return (
    body.error_description ??
    body.message ??
    body.error ??
    (body.status ? `HTTP ${body.status}` : "unknown error")
  );
}
