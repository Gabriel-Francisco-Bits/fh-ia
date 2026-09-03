# fh-code

Editor de código **fh-code**: interfaz tipo Cursor / OpenCode, con el **motor Monaco de VS Code** y **fh-ia** integrado a la derecha (Claude, Grok, OpenAI, FCC, skills del repo, modos Preguntar / Plan / Autónomo).

No es un fork completo de `microsoft/vscode`. Usa el mismo componente de edición que VS Code (`monaco-editor`) y el mismo agente que la extensión fh-ia.

## Arranque

Desde la raíz del repo:

```bash
npm run fh-code
```

Abre [http://127.0.0.1:3847](http://127.0.0.1:3847). Carpeta y puerto opcionales:

```bash
npm run compile
node fh-code/server.js /ruta/al/proyecto
# FH_IA_EDITOR_PORT=4000 FH_IA_WORKSPACE=/ruta node fh-code/server.js
```

Autenticación: la misma que la extensión (`grok login`, `claude`, API keys en `~/.fh-ia/settings.json` o `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). FCC: `fcc-server` en `localhost:8082`.

## Atajos

- `Ctrl+S` / `Cmd+S` guardar
- `Enter` enviar chat (`Shift+Enter` nueva línea)
