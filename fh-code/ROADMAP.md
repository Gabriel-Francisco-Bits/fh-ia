# fh-code — Estado del Proyecto y Funcionalidades

App de escritorio tipo Cursor con Monaco Editor (VS Code engine) + servidor local + agente de IA fh-ia integrado (Claude, Grok, OpenAI, FCC).

## Funcionalidades Completadas

1. **IDE Esencial ([#9](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/9))**:
   - Paleta de comandos (`Ctrl+Shift+P`) y apertura rápida de archivos (`Ctrl+P`) con navegación por teclado.
   - Búsqueda en archivo (`Ctrl+F`) y búsqueda recursiva en todo el workspace (`Ctrl+Shift+F`) con navegación por coincidencia y línea.
   - Pestañas completas con botón de cierre (`✕`), atajo `Ctrl+W` e indicador de archivo modificado no guardado (`●`).
   - Diálogo modal y API para **Abrir carpeta** (`/api/workspace/open`), permitiendo cambiar dinámicamente de espacio de trabajo.
   - Recarga automática del buffer de Monaco al aceptar propuestas de edición (`Accept`).

2. **Terminal Integrada y Panel Git ([#10](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/10))**:
   - Panel inferior colapsable con pestañas intercambiables `Terminal` y `Git` (`Ctrl+\``).
   - Terminal interactiva conectada por streaming bidireccional en tiempo real (ejecuta en el workspace con historial y shell del sistema).
   - Vista Git: estado del repositorio y ramas, cambios staged / unstaged / untracked, staging unitario o total (`Stage All`), commit con mensaje y visor de diffs.

3. **IntelliSense con Language Services (LSP) ([#11](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/11))**:
   - Soporte completo de TypeScript y JavaScript mediante el compilador integrado de Monaco (autocompletado, sugerencia de parámetros, hover con tipos y documentación, ir a definición).
   - Diagnósticos en tiempo real de errores sintácticos y semánticos (markers en el editor) mediante `/api/lsp/diagnostics` (JSON, JavaScript, Python, Shell).
   - Extracción de símbolos de código (`/api/lsp/symbols`).

4. **Instaladores y Monaco Offline ([#12](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/12))**:
   - Empaquetado de producción de instaladores `.deb` (Debian/Ubuntu), `.AppImage`, `.exe`/NSIS y `.dmg` configurados en `electron-builder.yml`.
   - Monaco Editor empaquetado localmente en `fh-code/public/vendor/monaco/`, permitiendo funcionamiento 100% offline sin depender de CDN.
   - Icono PNG de alta resolución (512x512) integrado en la aplicación de escritorio y en las entradas `.desktop`.

5. **Ajustes en la UI y Sincronización de Edits ([#13](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/13))**:
   - Modal de Ajustes accesible desde el título, barra de actividad o `Ctrl+,`.
   - Configuración de IA activa, claves de API, URLs base, modelos y failover.
   - Personalización de interfaz: tema visual (oscuro / claro / auto) y tamaño de fuente del editor en tiempo real.
   - Botón de restablecimiento de fábrica (`Restablecer ajustes`).
   - Sincronización inmediata del buffer en Monaco tras aceptar ediciones de IA.

6. **Cursor Composer Multi-archivo con Checkpoints y Rollback ([#15](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/15))**:
   - Panel modal flotante `Ctrl+I` para edición e instrucciones de múltiples archivos a la vez.
   - Sistema de snapshots automáticos antes de cada lote de edición con botón de Rollback integral.
   - Árbol de archivos afectados con estado y estadísticas de líneas añadidas/eliminadas.

7. **Cursor Inline Edit en Monaco ([#16](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/16))**:
   - Widget flotante contextual interactivo (`Ctrl+K` / `Cmd+K`) directamente sobre la selección de código.
   - Generación de código rápida mediante `/api/inline-edit` con atajos de confirmación (`Enter` para aceptar, `Esc` para descartar).

8. **Indexación Semántica y Búsqueda Vectorial ([#17](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/17))**:
   - Motor `SemanticIndex` en segundo plano con chunking sintáctico y ponderación híbrida BM25 + TF-IDF.
   - Consulta semántica completa del repositorio con mención `@codebase`.
   - Endpoints `/api/index/status` y `/api/index/search`.

9. **Menciones Contextuales Avanzadas ([#18](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/18))**:
   - Soporte para `@git` (diffs de rama y status), `@terminal` (últimos buffers de salida), `@symbols` (árbol de funciones y clases del archivo) y `@file` (contenido íntegro).
   - Inyección contextual estructurada en el payload del prompt de IA.

10. **Cursor Tab: Autocompletado Predictivo Multi-línea ([#19](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/19))**:
    - `InlineCompletionsProvider` registrado en Monaco con texto predictivo fantasma atenuado (Ghost Text).
    - Aceptación fluida con tecla `Tab` y cancelación con `Esc`, con debounce inteligente para evitar sobrecarga.

11. **Reglas de Proyecto Jerárquicas ([#20](https://github.com/Gabriel-Francisco-Bits/fh-ia/issues/20))**:
    - Detección y lectura automática de reglas del espacio de trabajo (`.cursorrules`, `.fhrules`, `rules.md`, `AGENTS.md`) y globales (`~/.config/fh-code/rules.md`).
    - Inyección prioritaria de instrucciones en el prompt del sistema y endpoint `/api/rules`.

12. **Iconografía y Estética Idéntica a Cursor / VS Code**:
    - Reemplazo integral de emojis por iconos vectoriales SVG nativos y nítidos: barra de actividad (`files`, `search`, `source-control`, `terminal`, `settings`, `sparkle` de Cursor).
    - Conjunto de iconos por tipo de archivo (`TS`, `JS`, `JSON`, `Markdown`, `HTML`, `CSS`, `Python`, `Git`, `Shell`, etc.) y carpetas vectoriales dinámicas con estado abierto/cerrado y rotación suave de chevrons.
    - Pestañas con borde superior de acento activo (`#3b82f6`), botón de cierre `✕` SVG y sincronización de icono según el contenido.
    - Barra de actividad con indicador lateral vertical y paleta oscura Cursor Dark (`#141416` / `#18181b` / `#1e1e20`).
