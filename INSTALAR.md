# Abrir este archivo e instalar fh-ia

## En este PC (más fácil)

Doble clic en el escritorio: **Instalar fh-ia**

Si Ubuntu pregunta “¿Confías en este launcher?”, elige **Permitir iniciar**.

## Desde GitHub (un archivo)

1. Descarga solo esto:  
   https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.sh
2. Hazlo ejecutable y ábrelo:

```bash
chmod +x Instalar-fh-ia.sh
./Instalar-fh-ia.sh
```

El script instala el VSIX **0.1.2** (con failover) en **VS Code**, **Cursor** y **VSCodium** si están instalados.

Failover (activo por defecto): si Grok/Claude/OpenAI falla, fh-ia prueba la siguiente IA (`fhIa.failover.order`).

## Repo y release

- Código: https://github.com/Gabriel-Francisco-Bits/fh-ia
- VSIX: https://github.com/Gabriel-Francisco-Bits/fh-ia/releases/latest
