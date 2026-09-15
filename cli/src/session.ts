import { CLI_CLIENT_ID, formatUserCode } from "ai-tutor-todo-api";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { CliError, describe, reach } from "./errors";

// Better Auth's own client, so the device flow's request and response shapes
// come from the plugin rather than being re-declared here.
const authClient = (server: string) =>
  createAuthClient({
    baseURL: server,
    plugins: [deviceAuthorizationClient()],
  });

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const expired = () =>
  new CliError("The code expired before it was approved. Run: ai-tutor login");

/**
 * RFC 8628 from the device's side: get a code, show it, then poll until the
 * user decides in the browser. Resolves to the access token, which the server
 * has already signed (lib/auth-config.ts) so it works as a Bearer token.
 */
export async function deviceLogin(
  server: string,
  print: (line?: string) => void,
): Promise<string> {
  const client = authClient(server);
  const { data: grant, error } = await reach(server, () =>
    client.device.code({ client_id: CLI_CLIENT_ID }),
  );
  if (!grant) {
    throw new CliError(`${server} would not start a login: ${describe(error)}`);
  }

  print(
    "To log in, open this page in a browser where you are signed in to ai-tutor:",
  );
  print();
  print(`  ${grant.verification_uri_complete}`);
  print();
  print(
    `and approve the code ${formatUserCode(grant.user_code)} (or open ${grant.verification_uri} and enter it there).`,
  );
  print(
    `Waiting for approval; the code expires in ${Math.round(grant.expires_in / 60)} minutes.`,
  );

  let interval = grant.interval * 1000;
  const deadline = Date.now() + grant.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { data, error } = await reach(server, () =>
      client.device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: grant.device_code,
        client_id: CLI_CLIENT_ID,
      }),
    );
    if (data) {
      return data.access_token;
    }

    const code = (error as { error?: string } | null)?.error;
    if (code === "authorization_pending") {
      continue;
    }
    if (code === "slow_down") {
      // RFC 8628 §3.5: each slow_down adds five seconds for the rest of the flow.
      interval += 5000;
      continue;
    }
    if (code === "access_denied") {
      throw new CliError(
        "The code was denied in the browser. Nothing was stored.",
      );
    }
    if (code === "expired_token") {
      throw expired();
    }
    throw new CliError(`${server} refused the login: ${describe(error)}`);
  }
  throw expired();
}

/** The account behind a token, or null once the server no longer honours it. */
export async function tokenUser(server: string, token: string) {
  const { data, error } = await reach(server, () =>
    authClient(server).getSession({ fetchOptions: bearer(token) }),
  );
  if (error) {
    throw new CliError(
      `${server} could not check the token: ${describe(error)}`,
    );
  }
  return data?.user ?? null;
}

/** Ends the session behind the token, which is what makes every copy useless. */
export async function revokeToken(server: string, token: string) {
  const { error } = await reach(server, () =>
    authClient(server).signOut({ fetchOptions: bearer(token) }),
  );
  if (error) {
    throw new CliError(describe(error));
  }
}
