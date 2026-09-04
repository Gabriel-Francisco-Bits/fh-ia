# fh-code

Editor de código **fh-code**: interfaz tipo Cursor / OpenCode, con el **motor Monaco de VS Code** y **fh-ia** integrado a la derecha (Claude, Grok, OpenAI, FCC, skills del repo, modos Preguntar / Plan / Autónomo).

No es un fork completo de `microsoft/vscode`. Usa el mismo componente de edición que VS Code (`monaco-editor`) y el mismo agente que la extensión fh-ia.

## Arranque

Desde la raíz del repo:

```bash
npm run fh-code
```

Abre la ventana de escritorio **fh-code** (Electron, Linux / Windows / macOS). Si Electron no está disponible, el servidor local queda en [http://127.0.0.1:3847](http://127.0.0.1:3847).

Empaquetado multiplataforma (directorios de app):

```bash
npm run fh-code:dist
```

Carpeta y puerto opcionales:

```bash
npm run compile
node fh-code/server.js /ruta/al/proyecto
# FH_IA_EDITOR_PORT=4000 FH_IA_WORKSPACE=/ruta node fh-code/server.js
```

Autenticación: la misma que la extensión (`grok login`, `claude`, API keys en `~/.fh-ia/settings.json` o `XAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). FCC: `fcc-server` en `localhost:8082`.

Qué falta y issues: [ROADMAP.md](ROADMAP.md).

## Atajos de Teclado y Características Cursor-Grade

- `Ctrl+K` / `Cmd+K`: **Cursor Inline Edit** — Edición y generación de código contextual flotante sobre la selección actual.
- `Ctrl+I` / `Cmd+I`: **Cursor Composer** — Edición y generación multi-archivo con checkpoints y rollback instantáneo.
- `Tab`: **Cursor Tab** — Aceptación de autocompletado predictivo multi-línea con Ghost Text.
- `Ctrl+P`: **Quick Open** — Búsqueda rápida y navegación de archivos en el workspace.
- `Ctrl+S` / `Cmd+S`: Guardar archivo actual.
- `Enter` / `Ctrl+Enter`: Enviar consulta al chat (`Shift+Enter` nueva línea).

## Menciones Contextuales (@)
- `@files`: Inyección rápida del contenido de archivos del proyecto.
- `@symbols`: Extracción de funciones, interfaces y clases del código.
- `@git`: Inserción del estado de git, rama activa y diff actual.
- `@terminal`: Volcado del buffer de salida de la terminal integrada.
- `@codebase`: Búsqueda semántica e indexación vectorial del repositorio.
- `@docs` & `@web`: Contexto de documentación y consultas web actualizadas.

## Reglas de Proyecto (.cursorrules / .fhrules)
fh-code detecta e inyecta automáticamente en el system prompt del agente las reglas definidas en:
- `.cursorrules`
- `.fhrules`
- `rules.md` o `fh-rules.md`
- `AGENTS.md` / `GEMINI.md` / `CLAUDE.md`
- Reglas globales en `~/.config/fh-code/rules.md` (editables desde `/api/rules`).
