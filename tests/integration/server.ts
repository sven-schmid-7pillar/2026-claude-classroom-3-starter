import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import type { TestProject } from "vitest/node";
import { removeTempDir } from "@/tests/unit/temp-dir";

/*
 * Global setup of the integration project: builds the CLI exactly as
 * `npm install` does and starts the web app under `next dev` on a spare port
 * over a throwaway database, once for every file in tests/integration. The
 * files run in parallel against it, so each signs in a user of its own.
 */

declare module "vitest" {
  export interface ProvidedContext {
    integration: {
      /** The web app's origin, which is also the CLI's AI_TUTOR_URL. */
      server: string;
      databaseUrl: string;
      /** The server's BETTER_AUTH_SECRET, for signing test sessions. */
      secret: string;
      /** The built CLI entry point, to run with `process.execPath`. */
      cli: string;
    };
  }
}

const root = resolve(import.meta.dirname, "..", "..");
const secret = "cli-integration-secret-at-least-32-chars";

export default async function setup(project: TestProject) {
  execFileSync(process.execPath, ["build.mjs"], { cwd: join(root, "cli") });

  const dir = await mkdtemp(join(tmpdir(), "ai-tutor-integration-"));
  const databaseUrl = `file:${join(dir, "app.db")}`;
  const db = drizzle({ connection: { url: databaseUrl } });
  await migrate(db, { migrationsFolder: join(root, "drizzle") });
  db.$client.close();

  const server = `http://localhost:${await sparePort()}`;
  let output = "";
  const next = spawn(
    process.execPath,
    [
      join(root, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--port",
      new URL(server).port,
    ],
    {
      cwd: root,
      // Own dist dir (see next.config.ts), so neither `npm run dev` nor the
      // Playwright server stands in the way. NODE_ENV replaces Vitest's
      // `test`, which `next dev` warns about.
      env: {
        ...process.env,
        NODE_ENV: "development",
        NEXT_DIST_DIR: ".next-cli-e2e",
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: server,
        BETTER_AUTH_SECRET: secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group on POSIX, so stopServer can end the whole tree.
      detached: process.platform !== "win32",
    },
  );
  next.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  next.stderr?.on("data", (chunk) => {
    output += chunk;
  });

  const teardown = async () => {
    await stopServer(next);
    await removeTempDir(dir);
  };
  try {
    await waitForServer(next, server, () => output);
  } catch (error) {
    await teardown();
    throw error;
  }

  project.provide("integration", {
    server,
    databaseUrl,
    secret,
    cli: join(root, "cli", "dist", "index.js"),
  });
  return teardown;
}

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

function sparePort() {
  return new Promise<number>((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

async function waitForServer(
  next: ChildProcess,
  server: string,
  output: () => string,
) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (next.exitCode !== null) {
      throw new Error(`next dev exited early:\n${output()}`);
    }
    try {
      if ((await fetch(`${server}/api/auth/ok`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`next dev did not answer within 3 minutes:\n${output()}`);
}

async function stopServer(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((done) => child.once("exit", done));
  // `next dev` serves from a child process of its own, so end the whole tree.
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    process.kill(-child.pid, "SIGTERM");
  }
  await exited;
}
