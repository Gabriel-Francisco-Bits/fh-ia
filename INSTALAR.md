# Instalar fh-ia

Repo público: no hace falta clonar ni bajar archivos a mano.

## Un comando

```bash
curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
```

Eso descarga el VSIX del último release e instala la extensión en **VS Code**, **Cursor** y **VSCodium** si están en el PATH.

## En este PC (si ya tienes el repo)

Doble clic en **Instalar fh-ia** o:

```bash
./Instalar-fh-ia.sh
```

Si Ubuntu pregunta “¿Confías en este launcher?”, elige **Permitir iniciar**.

## Después de instalar

Abre VS Code → icono **fh-ia** a la izquierda.

- **IA**: Claude, Grok, OpenAI o **Free Claude Code** (`fcc-server` en localhost:8082)
- **Modo**: Preguntar / Plan / Autónomo
- **+**: chat independiente (pestaña)
- **⚙**: claves, failover, tema blanco/oscuro, tamaño de texto e iconos, colores

Free Claude Code: https://github.com/Alishahryar1/free-claude-code — arranca `fcc-server` y elige esa IA en el panel.

## Repo y release

- Código: https://github.com/Gabriel-Francisco-Bits/fh-ia
- VSIX: https://github.com/Gabriel-Francisco-Bits/fh-ia/releases/latest
