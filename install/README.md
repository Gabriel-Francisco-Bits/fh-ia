# Instalación simple

1. Abre **`Instalar-fh-ia.desktop`** (doble clic) **o** ejecuta `./Instalar-fh-ia.sh`
2. Confirma “Permitir iniciar” si Ubuntu lo pide
3. En VS Code aparece el icono **fh-ia**

Instalación sin descargar el repo (también actualiza):

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh | bash
```

Windows:

```powershell
irm https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.ps1 | iex
```

Si ejecutas el script junto al código, usa el `fh-ia.vsix` local. Si no hay VSIX al lado, lo baja del último release de GitHub.
