# fh-code — qué hay y qué falta

Estado actual (main, PR #8): app de escritorio Electron + servidor local, estética Cursor (archivos | Monaco | chat fh-ia), layout que **no** oculta el chat en pantallas estrechas.

## Lo que ya funciona

- Ventana nativa (`npm run fh-code` / `fh-code` en PATH)
- Explorador, pestañas, editor Monaco, guardar (`Ctrl+S`)
- Chat fh-ia: Claude / Grok / OpenAI / FCC, modelo, Preguntar / Plan / Autónomo
- Skills del repo y del usuario, en cualquier IA
- Empaquetado declarado para Linux, Windows y macOS (`electron-builder.yml`, target `dir`)

## Lo que falta (para otro día)

Agrupado en issues:

1. **IDE esencial** — [#9](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/9) paleta, buscar, pestañas, abrir carpeta.
2. **Terminal + Git** — [#10](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/10)
3. **IntelliSense (LSP)** — [#11](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/11)
4. **Instaladores y Monaco offline** — [#12](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/12)
5. **Ajustes en la UI y Apply de edits** — [#13](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/13)

No está en el alcance cercano: fork completo de VS Code, marketplace de extensiones, agentes en la nube, login tipo Cursor.
