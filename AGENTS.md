# Reglas del Proyecto fh-code (Standing Rules)

## 1. Flujo de Trabajo Obligatorio de Git (Issue ➔ Rama ➔ PR ➔ Merge)
* **PROHIBIDO**: Confirmar o subir cambios directamente a la rama principal (`main` o `master`).
* **Protocolo de 6 pasos**:
  1. **Issue**: Todo cambio debe estar asociado a un Issue existente o creado previamente (`gh issue create`).
  2. **Rama**: Crear una rama temática a partir de `main` actualizado: `<tipo>/issue-<ID>-<descripcion>` (ej. `feat/issue-42-agentic-loop`).
  3. **Desarrollo**: Modificaciones quirúrgicas respetando arquitectura y estilo.
  4. **Validación**: Ejecutar y pasar la suite de pruebas (`npm run compile && npm test`) al 100% antes de hacer commit.
  5. **Pull Request (PR)**: Subir la rama y abrir PR referenciando el issue (`Closes #<ID>` / `Fixes #<ID>`).
  6. **Merge & Limpieza**: Mergear vía PR (`gh pr merge --squash --delete-branch`), actualizar `main` local y eliminar la rama temporal.

## 2. Calidad de Código y Estilo
* Preservar tipos estrictos en TypeScript y compatibilidad con Node v20+.
* Toda nueva funcionalidad de backend o UI debe acompañarse de sus pruebas automatizadas en `fh-code/*.test.js` o `src/test/*.test.ts`.
* No degradar el rendimiento de la aplicación de escritorio (`fh-code`).
