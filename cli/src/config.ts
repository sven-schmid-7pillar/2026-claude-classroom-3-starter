import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CliError, notLoggedIn } from "./errors";

export const DEFAULT_SERVER = "http://localhost:3000";

/** The server every command talks to: `AI_TUTOR_URL`, else the dev server. */
export function serverUrl(): string {
  const raw = process.env.AI_TUTOR_URL?.trim() || DEFAULT_SERVER;
  if (!URL.canParse(raw)) {
    throw new CliError(`AI_TUTOR_URL is not a URL: ${raw}`);
  }
  // One spelling per server, since it keys hosts.json.
  return new URL(raw).href.replace(/\/+$/, "");
}

/**
 * Found the way gh finds its own: the explicit override, then the XDG config
 * home, then %AppData% on Windows, then ~/.config. Never the working
 * directory, so a token cannot end up in a checkout.
 */
export function configDir(): string {
  const env = process.env;
  if (env.AI_TUTOR_CONFIG_DIR) {
    return env.AI_TUTOR_CONFIG_DIR;
  }
  if (env.XDG_CONFIG_HOME) {
    return join(env.XDG_CONFIG_HOME, "ai-tutor");
  }
  if (process.platform === "win32" && env.APPDATA) {
    return join(env.APPDATA, "ai-tutor");
  }
  return join(homedir(), ".config", "ai-tutor");
}

export const hostsFile = () => join(configDir(), "hosts.json");

// Keyed by server URL, like gh's hosts.yml, so each server keeps its own login.
const hostsSchema = z.record(
  z.string(),
  z.object({ token: z.string().min(1), email: z.string() }),
);
type Hosts = z.infer<typeof hostsSchema>;
export type Credentials = Hosts[string];

async function readHosts(): Promise<Hosts> {
  const file = hostsFile();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const parsed = hostsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new CliError(
      `${file} is not a valid token file. Delete it and run: ai-tutor login`,
    );
  }
  return parsed.data;
}

/**
 * The new contents go to a sibling file created owner-only (0600, inside a
 * 0700 directory) that is then renamed over the old one, so the token is never
 * readable by anyone else, not even halfway through a write. Windows ignores
 * the mode bits; there the per-user ACL on %AppData% does that job.
 */
async function writeHosts(hosts: Hosts) {
  const file = hostsFile();
  if (Object.keys(hosts).length === 0) {
    await rm(file, { force: true });
    return;
  }

  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(hosts, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies to a file writeFile creates; a stale temp keeps its own.
  await chmod(temp, 0o600);
  await rename(temp, file);
}

export async function credentialsFor(
  server: string,
): Promise<Credentials | undefined> {
  return (await readHosts())[server];
}

/** The configured server and its stored token, or the exit-4 error to log in. */
export async function session() {
  const server = serverUrl();
  const credentials = await credentialsFor(server);
  if (!credentials) {
    throw notLoggedIn(server);
  }
  return { server, ...credentials };
}

export async function saveCredentials(
  server: string,
  credentials: Credentials,
) {
  const hosts = await readHosts();
  hosts[server] = credentials;
  await writeHosts(hosts);
}

export async function deleteCredentials(server: string) {
  const hosts = await readHosts();
  delete hosts[server];
  await writeHosts(hosts);
}
