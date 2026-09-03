# Instalar fh-ia

Repo público: no hace falta clonar ni bajar el VSIX a mano. El mismo comando **instala y actualiza**.

## Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
```

## macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
```

O descarga el repo y doble clic en **Instalar-fh-ia.command** (si macOS lo bloquea: clic derecho → Abrir).

## Windows

PowerShell:

```powershell
irm https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.ps1 | iex
```

O doble clic en **Instalar-fh-ia.cmd**.

Instala la extensión en **VS Code**, **Cursor** y **VSCodium** si están instalados.

## Después de instalar

Abre VS Code → icono **fh-ia** a la izquierda. Recarga la ventana si ya estaba abierta.

- **IA**: Claude, Grok, OpenAI o **FCC** (Free Claude Code, `fcc-server` en localhost:8082)
- **Modelo**: solo los de esa IA
- **Modo**: Preguntar / Plan / Autónomo
- **+**: chat independiente
- **⚙**: claves, failover, tema, tamaño de texto e iconos, colores

FCC: https://github.com/Alishahryar1/free-claude-code — arranca `fcc-server` y elige **FCC** en el desplegable IA.

## Repo y release

- Código: https://github.com/Gabriel-Francisco-Bits/fh-ia
- VSIX: https://github.com/Gabriel-Francisco-Bits/fh-ia/releases/latest
