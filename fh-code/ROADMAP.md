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
