#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
  configDir,
  credentialsFor,
  DEFAULT_SERVER,
  deleteCredentials,
  saveCredentials,
  serverUrl,
} from "./config";
import { CliError, notLoggedIn, tokenRejected } from "./errors";
import { deviceLogin, revokeToken, tokenUser } from "./session";
import { addTodo, completeTodo, formatTodo, listTodos } from "./todos";

const print = (line = "") => {
  process.stdout.write(`${line}\n`);
};
const printJson = (value: unknown) => print(JSON.stringify(value, null, 2));

/** The configured server and its stored token, or the exit-4 error to log in. */
async function session() {
  const server = serverUrl();
  const credentials = await credentialsFor(server);
  if (!credentials) {
    throw notLoggedIn(server);
  }
  return { server, ...credentials };
}

/** Help shows the values in effect, so a reader need not work them out. */
function currently(read: () => string) {
  try {
    return read();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const program = new Command()
  .name("ai-tutor")
  .description(
    "Keep your ai-tutor to-do list from a terminal. Log in once by approving a one-time code in the web app, then add, list and complete items.",
  )
  .version(pkg.version)
  .showHelpAfterError("(run ai-tutor --help for usage)")
  .addHelpText(
    "after",
    () => `
Typical session:
  $ ai-tutor login            prints a URL and a code; approve it in the browser
  $ ai-tutor whoami           confirms which account the token belongs to
  $ ai-tutor add Buy milk     prints the new item with its id
  $ ai-tutor list             every item, oldest first
  $ ai-tutor list -q milk     only items whose title contains "milk"
  $ ai-tutor done <id>        marks the item with that id done
  $ ai-tutor logout           revokes and deletes the token

Output:
  Items print one per line as "<id>  [ ]  <title>", with [x] once done.
  add, list, done and whoami accept --json to print JSON instead; for add,
  list and done it is the API's own response body. Errors go to stderr.

Environment:
  AI_TUTOR_URL          server to use (default ${DEFAULT_SERVER})
                        now: ${currently(serverUrl)}
  AI_TUTOR_CONFIG_DIR   directory holding the token file
                        now: ${currently(configDir)}

Files:
  hosts.json in the config directory stores one token per server, readable
  only by you (mode 0600). The directory is $AI_TUTOR_CONFIG_DIR, else
  $XDG_CONFIG_HOME/ai-tutor, else %APPDATA%\\ai-tutor on Windows, else
  ~/.config/ai-tutor. No command ever prints the token.

Exit status:
  0  success
  1  failure: server unreachable, no such item, invalid input, code denied
  4  not logged in, or the server no longer accepts the stored token
     (run ai-tutor login)`,
  );

program
  .command("login")
  .description(
    "log in to the server by approving a one-time code in the browser",
  )
  .addHelpText(
    "after",
    `
Runs Better Auth's device authorization flow. Prints the URL of the web app's
approval page (with the code already filled in) and the code itself, then
polls the server every few seconds until someone signed in to the web app
approves or denies that code. It never opens a browser, so the URL can be
opened anywhere. Stays running while it waits; the code is valid for 30
minutes.

On approval it stores the token for this server in hosts.json, replacing any
earlier one, and prints "Logged in to <server> as <email>." A denied or
expired code exits with status 1 and stores nothing.`,
  )
  .action(async () => {
    const server = serverUrl();
    const token = await deviceLogin(server, print);
    const user = await tokenUser(server, token);
    if (!user) {
      throw new CliError(`${server} issued a token it does not accept.`);
    }
    await saveCredentials(server, { token, email: user.email });
    print(`Logged in to ${server} as ${user.email}.`);
  });

program
  .command("whoami")
  .description(
    "show which account the stored token belongs to; exits 4 when not logged in",
  )
  .option("--json", 'print {"server", "user": {"id", "name", "email"}}')
  .addHelpText(
    "after",
    `
Asks the server, so it also fails (status 4) when the stored token has been
revoked. Prints "Logged in to <server> as <email> (<name>)."`,
  )
  .action(async ({ json }: { json?: boolean }) => {
    const { server, token } = await session();
    const user = await tokenUser(server, token);
    if (!user) {
      throw tokenRejected(server);
    }
    if (json) {
      printJson({
        server,
        user: { id: user.id, name: user.name, email: user.email },
      });
    } else {
      print(`Logged in to ${server} as ${user.email} (${user.name}).`);
    }
  });

program
  .command("logout")
  .description("revoke the stored token on the server and delete it locally")
  .addHelpText(
    "after",
    `
Deletes the token from hosts.json first, then ends its session on the server,
so any copy of the token stops working too. Exits 1 if the server could not be
reached to revoke it (the local copy is gone either way), and 4 when there was
no token for this server.`,
  )
  .action(async () => {
    const { server, token, email } = await session();
    await deleteCredentials(server);
    try {
      await revokeToken(server, token);
    } catch (error) {
      if (error instanceof CliError) {
        throw new CliError(
          `Deleted the local token, but ${server} did not revoke it: ${error.message}`,
        );
      }
      throw error;
    }
    print(`Logged out of ${server} (${email}).`);
  });

program
  .command("add")
  .description("add an item to the list and print it with its new id")
  .argument(
    "<title...>",
    "the item's title; several words are joined with spaces, so quotes are optional",
  )
  .option("--json", 'print the API response {"todo": {"id", "title", "done"}}')
  .action(async (words: string[], { json }: { json?: boolean }) => {
    const { todo } = await addTodo(await session(), words.join(" "));
    if (json) {
      printJson({ todo });
    } else {
      print(formatTodo(todo));
    }
  });

program
  .command("list")
  .description("print the items on the list, oldest first")
  .option(
    "-q, --query <text>",
    "only items whose title contains <text>, ignoring case (the API's ?q= filter)",
  )
  .option(
    "--json",
    'print the API response {"todos": [{"id", "title", "done"}]}',
  )
  .addHelpText(
    "after",
    `
An empty result prints nothing on stdout and a note on stderr.`,
  )
  .action(async ({ query, json }: { query?: string; json?: boolean }) => {
    const { todos } = await listTodos(await session(), query);
    if (json) {
      printJson({ todos });
      return;
    }
    if (todos.length === 0) {
      process.stderr.write(
        query ? `No items match "${query}".\n` : "The list is empty.\n",
      );
    }
    for (const todo of todos) {
      print(formatTodo(todo));
    }
  });

program
  .command("done")
  .description("mark an item done and print it")
  .argument("<id>", "the item's id, as printed by add or list")
  .option("--json", 'print the API response {"todo": {"id", "title", "done"}}')
  .addHelpText(
    "after",
    `
Marking an item that is already done succeeds and changes nothing. An id that
is not on your list exits with status 1.`,
  )
  .action(async (id: string, { json }: { json?: boolean }) => {
    const { todo } = await completeTodo(await session(), id);
    if (json) {
      printJson({ todo });
    } else {
      print(formatTodo(todo));
    }
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  throw error;
});
