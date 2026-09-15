# ai-tutor as an MCP server for Claude Code

`ai-tutor mcp --stdio` runs a [Model Context Protocol](https://modelcontextprotocol.io) server that Claude Code starts as a child process and talks to over stdin and stdout. It offers the CLI's to-do commands as tools, calling the same REST API with the token `ai-tutor login` stored:

| Tool            | Input                    | Result                                 |
| --------------- | ------------------------ | -------------------------------------- |
| `list_todos`    | `q?` — title filter      | `{"todos": [{"id", "title", "done"}]}` |
| `add_todo`      | `title`                  | `{"todo": {"id", "title", "done"}}`    |
| `complete_todo` | `id` — from list or add  | `{"todo": {"id", "title", "done"}}`    |

In Claude Code they appear as `mcp__ai-tutor__list_todos` and so on. `npx ai-tutor mcp --help` prints the same reference.

The web app also serves the same tools itself at `/api/mcp`, which Claude Code reaches over HTTP and logs in to through the browser, with nothing to install or start on your machine: see [Connect to the web app over HTTP instead](#connect-to-the-web-app-over-http-instead).

## Before you register it

1. `npm install` at the root of this repository, which also builds `cli/dist/index.js` (after editing `cli/src/`, rebuild with `npm run build -w ai-tutor-cli`).
2. Start the web app with `npm run dev`. The server talks to `http://localhost:3000` unless `AI_TUTOR_URL` says otherwise.
3. Run `npx ai-tutor login` from the repository root and approve the code in the browser.

Steps 2 and 3 can also come later: the server starts without either, and each tool call says what is missing (`Not logged in to http://localhost:3000. Run: ai-tutor login`, or `Could not reach …`). The token is read on every call, so logging in takes effect without restarting Claude Code.

Every registration below runs the bundle with `node` and an absolute path, which works the same on Windows, macOS and Linux and does not depend on the directory Claude Code was started in. `npx ai-tutor` only resolves inside this workspace.

## Register it for this repository

From the repository root:

```sh
claude mcp add --transport stdio ai-tutor -- node "$PWD/cli/dist/index.js" mcp --stdio
```

The same line works in bash, zsh and PowerShell, which all expand `$PWD`. Everything after `--` is the server's command line, passed through untouched. This uses the default **local** scope: the entry is saved in `~/.claude.json` under this project's path, is private to you, and loads only when Claude Code runs in this repository.

To share the registration with everyone who clones the repository instead, commit a `.mcp.json` at its root (project scope):

```json
{
  "mcpServers": {
    "ai-tutor": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR:-.}/cli/dist/index.js", "mcp", "--stdio"]
    }
  }
}
```

Claude Code expands `${CLAUDE_PROJECT_DIR}` to the project root, and the `:-.` fallback stops `claude mcp list` from warning that the variable is missing when it runs outside a session. Each person approves a project-scoped server the first time they start `claude` in the repository; until then `claude mcp list` shows it as `⏸ Pending approval`. If a local entry with the same name exists as well, the local one wins.

## Register it for a project elsewhere on the machine

In that project's directory, point at this repository's bundle by its absolute path:

```sh
claude mcp add --transport stdio ai-tutor -- node /path/to/2026-claude-classroom-3-starter/cli/dist/index.js mcp --stdio
```

On Windows the path can be written `D:/projects/2026-claude-classroom-3-starter/cli/dist/index.js`. Add `--scope user` to make the server available in every project instead of just that one.

The to-do list belongs to your ai-tutor account rather than to any project, and the token lives in one per-user file (`hosts.json`, see `npx ai-tutor --help`), so a single `ai-tutor login` serves every registration that uses the same server. To use a server other than `http://localhost:3000`, pass it in the registration, with another option between `--env` and the server name as `claude mcp add` requires:

```sh
claude mcp add --env AI_TUTOR_URL=https://tutor.example.com --transport stdio ai-tutor -- node /path/to/2026-claude-classroom-3-starter/cli/dist/index.js mcp --stdio
```

Then log in to that server once with the same variable set: `AI_TUTOR_URL=https://tutor.example.com npx ai-tutor login` (in PowerShell, set `$env:AI_TUTOR_URL` first).

## Check that it is connected

From a terminal in the project:

```sh
claude mcp list
```

```text
ai-tutor: node D:/projects/2026-claude-classroom-3-starter/cli/dist/index.js mcp --stdio - ✔ Connected
```

`✔ Connected` means Claude Code started the server and completed the protocol handshake, which needs neither a login nor a running web app. `claude mcp get ai-tutor` shows the scope, status, command and arguments of that one entry.

Inside a Claude Code session, `/mcp` lists the connected servers; select `ai-tutor` to see its status and its three tools. To check the whole path through to the API, ask something like "What's on my ai-tutor to-do list?" and approve the `list_todos` call.

The same check works without a session. Print mode cannot ask for approval, so allow the three tools up front; `--tools ""` turns off the built-in tools so the answer can only come from the list:

```sh
claude -p "What's on my ai-tutor to-do list?" --tools "" --allowedTools "mcp__ai-tutor__list_todos mcp__ai-tutor__add_todo mcp__ai-tutor__complete_todo"
```

When something is off:

- `✘ Failed to connect`: run the registered command yourself, such as `node cli/dist/index.js mcp --stdio` in this repository. A healthy server prints nothing and waits for input (end it with Ctrl+C); a missing `cli/dist/index.js` or a module-not-found error means `npm install` has not been run.
- `⏸ Pending approval`: start `claude` in the project and accept the project's MCP server.
- A tool result saying `Not logged in` or `no longer accepts the stored token`: run `npx ai-tutor login` in this repository, then call the tool again.
- A tool result saying `Could not reach`: start the web app, or fix `AI_TUTOR_URL` in the registration.

To remove the server again, run `claude mcp remove ai-tutor`, adding `-s project` or `-s user` for those scopes.

## Connect to the web app over HTTP instead

The web app serves the same three tools at `/api/mcp` over [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), protected with OAuth. Claude Code connects to the URL and signs in through the browser; no CLI, no `ai-tutor login` and no local process are involved.

|                         | `ai-tutor mcp --stdio`                               | `/api/mcp`                                        |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Runs                    | on your machine, started by Claude Code              | inside the web app                                |
| Signs in with           | `ai-tutor login`, token in `hosts.json`              | OAuth in the browser, tokens kept by Claude Code  |
| Reaches the to-do list  | through the REST API                                 | through the database directly                     |

Both servers register the tools from the same definitions in the `ai-tutor-todo-api` workspace, so names, descriptions, input schemas and results are identical. The one message that differs is the error for an unknown id, which says to call `list_todos` rather than to run `ai-tutor list`.

### Register it

With the web app running, add it under a name of its own, so it can sit next to a stdio registration:

```sh
claude mcp add --transport http ai-tutor-web http://localhost:3000/api/mcp
```

The URL must be the app's `BETTER_AUTH_URL` followed by `/api/mcp`, exactly: tokens are issued for that URL alone, so `http://127.0.0.1:3000/api/mcp` does not work for an app whose `BETTER_AUTH_URL` is `http://localhost:3000`. For a deployed app, use its HTTPS URL. The tools appear as `mcp__ai-tutor-web__list_todos` and so on, and `--scope` works as above. The project-scoped `.mcp.json` equivalent is:

```json
{
  "mcpServers": {
    "ai-tutor-web": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

### Log in

Until you log in, `claude mcp list` shows the entry as `! Needs authentication`. Start the login from a terminal:

```sh
claude mcp login ai-tutor-web
```

or, inside a session, open `/mcp`, select `ai-tutor-web` and authenticate. Claude Code opens the browser (with `--no-browser`, or without a local browser, it prints the URL to open and asks for the address you land on):

1. If you are not signed in to the web app, `/login` comes first; its **Sign up** link creates an account without losing your place. After signing in you go straight on.
2. `/consent` names the application and the account, and says what it may do: read your to-do list, add items and mark them done, and keep that access without asking you again. Below it is the URL the application identified itself with. Choose **Allow**. (**Deny** sends Claude Code an access-denied answer, and nothing is stored.)
3. The browser returns to Claude Code, and `claude mcp list` shows `✔ Connected`.

There is no client ID to configure and no registration step: Claude Code identifies itself with a [Client ID Metadata Document](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration), an HTTPS URL of its own that the web app fetches and checks during the login. The web app therefore needs outbound HTTPS access. Dynamic Client Registration is switched off.

Claude Code keeps the access token and a refresh token and renews them itself, so one login lasts. Signing out of the web app does not end it; to drop the tokens Claude Code holds, run `claude mcp logout ai-tutor-web` or use **Clear authentication** in `/mcp`.

### How Claude Code finds the login

Each step can be followed with curl (in PowerShell, `curl.exe`):

```sh
curl -si -X POST http://localhost:3000/api/mcp -H "content-type: application/json" -d "{}"
curl -s http://localhost:3000/.well-known/oauth-protected-resource/api/mcp
curl -s http://localhost:3000/.well-known/oauth-authorization-server/api/auth
```

1. A request without a token is answered `401` with `WWW-Authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp", scope="todos"`.
2. That document (RFC 9728) names the resource `http://localhost:3000/api/mcp`, its scope `todos`, and the authorization server `http://localhost:3000/api/auth`.
3. The authorization server's metadata (RFC 8414) lists the endpoints under `/api/auth/oauth2/`, PKCE with `S256`, and `client_id_metadata_document_supported: true`.
4. After the login, every request carries a JWT access token signed by the web app (its keys are at `/api/auth/jwks`), issued for `/api/mcp` with the `todos` scope. Its subject is your user id, and that is the only thing that decides whose list the tools read and change.

The access token and the token `ai-tutor login` stores are not interchangeable: `/api/mcp` refuses session tokens, and `/api/todos` refuses access tokens.

### When something is off

- `! Needs authentication` right after logging in: the token was refused. Check that the registered URL is exactly `BETTER_AUTH_URL` plus `/api/mcp`, then run `claude mcp login ai-tutor-web` again.
- `✘ Failed to connect`: the web app is not running at that URL. If it is running but answers with an error, apply the migrations with `npm run db:migrate`.
- The browser shows an error instead of `/consent`: the web app could not fetch or accept Claude Code's client metadata document. It needs outbound HTTPS, and it refuses documents on private network addresses.
- `/consent` says **Nothing to allow**: the page was opened without a pending request. Start the login from Claude Code again.

To remove it, run `claude mcp remove ai-tutor-web`.
