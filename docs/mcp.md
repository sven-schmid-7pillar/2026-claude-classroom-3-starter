# ai-tutor as an MCP server for Claude Code

`ai-tutor mcp --stdio` runs a [Model Context Protocol](https://modelcontextprotocol.io) server that Claude Code starts as a child process and talks to over stdin and stdout. It offers the CLI's to-do commands as tools, calling the same REST API with the token `ai-tutor login` stored:

| Tool            | Input                    | Result                                 |
| --------------- | ------------------------ | -------------------------------------- |
| `list_todos`    | `q?` — title filter      | `{"todos": [{"id", "title", "done"}]}` |
| `add_todo`      | `title`                  | `{"todo": {"id", "title", "done"}}`    |
| `complete_todo` | `id` — from list or add  | `{"todo": {"id", "title", "done"}}`    |

In Claude Code they appear as `mcp__ai-tutor__list_todos` and so on. `npx ai-tutor mcp --help` prints the same reference.

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
