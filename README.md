# fh-ia

A Visual Studio Code extension with a sidebar agent chat panel (same idea as the Claude Code IDE panel) that can talk to **Claude** (Anthropic), **Grok** (xAI), or any **OpenAI-compatible** endpoint.

## Install (one command)

Public repo — no manual download:

```bash
curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
```

See **[INSTALAR.md](INSTALAR.md)**. If you already have the folder, double-click **`Instalar-fh-ia.desktop`** or run `./Instalar-fh-ia.sh`. The script installs the latest GitHub Release VSIX into VS Code, Cursor, and/or VSCodium.

Switching the IA in the panel dropdown routes the next prompt to that backend. You do not need to reload the extension host.

If the selected IA fails (network, 429/5xx, or missing credentials), **failover** tries the next one (`fhIa.failover.order`, default `grok,claude,openai`). Turn it off with `fhIa.failover.enabled: false`.

## Features

- Activity-bar **fh-ia** chat panel (also `fh-ia: Open Chat Panel` in the Command Palette)
- **Nuevo chat** (`+`) opens an independent conversation tab, like Claude Code
- Switch **IA** (Claude / Grok / OpenAI) and **model** from the panel
- Agent **mode**: Preguntar (Accept/Reject), Plan (no writes), Autónomo (applies edits)
- **Ajustes** gear: API keys, URLs, failover, **Free Claude Code**, light/dark theme, font/icon size, colors
- **Free Claude Code** (`fcc-server` at `http://127.0.0.1:8082`) as a selectable IA — [Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code)
- Streamed replies in the panel
- Open folder, repo tree, and open editors are attached on every prompt
- Active editor file and current selection are attached automatically
- Extra files via `@path/to/file` in the prompt
- Proposed file edits as a reviewable diff with **Accept** (writes to disk) and **Reject** (leaves the original file unchanged)

## Install from VSIX

From this folder:

```bash
npm ci
npm run package
```

That produces `fh-ia-0.1.5.vsix`. Then in VS Code:

1. Command Palette → **Extensions: Install from VSIX…**
2. Select `fh-ia-0.1.5.vsix`
3. Open the **fh-ia** icon in the activity bar

## Extension Development Host

1. Open this folder in VS Code
2. `npm ci && npm run compile`
3. Press **F5** (Run Extension) to launch the Extension Development Host
4. In the new window, open the fh-ia view

## Authentication

Two ways, both work. Default mode is `fhIa.authMode` = **auto**:

1. **API key** in Settings (`fhIa.*.apiKey`) — always wins if you set it
2. **Terminal login** (same session as the CLI)
   - Grok: `grok login` → `~/.grok/auth.json` (OIDC token; refreshed automatically)
   - Claude: log in with `claude` → `~/.claude/.credentials.json` or `CLAUDE_CODE_OAUTH_TOKEN`
   - OpenAI/Codex: `~/.codex/auth.json` or `OPENAI_API_KEY`
3. **Environment variable** API key, if you are not logged in

| Provider | Setting | Env | Terminal |
| --- | --- | --- | --- |
| Claude / Anthropic | `fhIa.claude.apiKey` | `ANTHROPIC_API_KEY` | `claude` login |
| Grok / xAI | `fhIa.grok.apiKey` | `XAI_API_KEY` | `grok login` |
| OpenAI-compatible | `fhIa.openai.apiKey` | `OPENAI_API_KEY` | Codex `~/.codex/auth.json` |

Set `fhIa.authMode` to `apiKey` to ignore CLI sessions, or `terminal` to use only the CLI login.

Related settings:

- `fhIa.provider` — `claude` \| `grok` \| `openai`
- `fhIa.claude.baseUrl` (default `https://api.anthropic.com`)
- `fhIa.grok.baseUrl` (default `https://api.x.ai`)
- `fhIa.openai.baseUrl` (default `https://api.openai.com/v1`) plus `fhIa.*.model`

Point `fhIa.openai.baseUrl` at any Chat Completions-compatible server (OpenAI, Azure-style proxies, local models, etc.).

## Tests

```bash
npm ci
npm test
```
