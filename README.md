# fh-ia

A Visual Studio Code extension with a sidebar agent chat panel (same idea as the Claude Code IDE panel) that can talk to **Claude** (Anthropic), **Grok** (xAI), or any **OpenAI-compatible** endpoint.

## Install (one click)

See **[INSTALAR.md](INSTALAR.md)**. Double-click **`Instalar-fh-ia.desktop`** or run:

```bash
chmod +x Instalar-fh-ia.sh
./Instalar-fh-ia.sh
```

That installs `install/fh-ia.vsix` (or downloads it from GitHub Releases) into VS Code, Cursor, and/or VSCodium.

Switching the IA in the panel dropdown routes the next prompt to that backend. You do not need to reload the extension host.

## Features

- Activity-bar **fh-ia** chat panel (also `fh-ia: Open Chat Panel` in the Command Palette)
- Streamed replies in the panel
- Active editor file and current selection are attached automatically
- Extra files via `@path/to/file` in the prompt
- Proposed file edits as a reviewable diff with **Accept** (writes to disk) and **Reject** (leaves the original file unchanged)

## Install from VSIX

From this folder:

```bash
npm ci
npm run package
```

That produces `fh-ia-0.1.1.vsix`. Then in VS Code:

1. Command Palette → **Extensions: Install from VSIX…**
2. Select `fh-ia-0.1.1.vsix`
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
