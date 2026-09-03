# Instalación de fh-ia en Windows (VS Code / Cursor / VSCodium)
# Un comando:
#   irm https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.ps1 | iex
$ErrorActionPreference = "Stop"
Write-Host "[INFO] Iniciando instalación de fh-ia..."

$Repo = if ($env:FH_IA_REPO) { $env:FH_IA_REPO } else { "Gabriel-Francisco-Bits/fh-ia" }
$Cache = Join-Path $env:LOCALAPPDATA "fh-ia"
New-Item -ItemType Directory -Force -Path $Cache | Out-Null

function Find-LocalVsix {
  $here = $PSScriptRoot
  if (-not $here) { return $null }
  $candidates = @(
    (Join-Path $here "install\fh-ia.vsix"),
    (Join-Path $here "fh-ia.vsix")
  )
  Get-ChildItem -Path $here -Filter "fh-ia-*.vsix" -ErrorAction SilentlyContinue | ForEach-Object { $candidates += $_.FullName }
  $best = $null
  foreach ($f in $candidates) {
    if (Test-Path $f) {
      if (-not $best -or (Get-Item $f).LastWriteTime -ge (Get-Item $best).LastWriteTime) {
        $best = $f
      }
    }
  }
  return $best
}

function Get-LatestVsix {
  $dest = Join-Path $Cache "fh-ia.vsix"
  Write-Host "[INFO] Descargando VSIX desde GitHub ($Repo)..."
  $url = "https://github.com/$Repo/releases/latest/download/fh-ia.vsix"
  try {
    $api = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "fh-ia-installer" }
    $asset = $api.assets | Where-Object { $_.name -like "*.vsix" } | Select-Object -First 1
    if ($asset.browser_download_url) { $url = $asset.browser_download_url }
  } catch { }
  Write-Host "[INFO] URL: $url"
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  if (-not (Test-Path $dest) -or (Get-Item $dest).Length -le 0) {
    throw "La descarga del VSIX quedó vacía"
  }
  return $dest
}

$vsix = Find-LocalVsix
if ($vsix) {
  Write-Host "[INFO] VSIX: $vsix"
} else {
  $vsix = Get-LatestVsix
  Write-Host "[INFO] VSIX descargado: $vsix"
}

function Test-Editor($cmd) {
  if (-not $cmd) { return $false }
  try {
    & $cmd --version 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

$editors = @()
$seen = @{}
function Add-Editor($cmd) {
  if (-not $cmd) { return }
  if ($seen.ContainsKey($cmd)) { return }
  if (Test-Editor $cmd) {
    $seen[$cmd] = $true
    $script:editors += $cmd
  }
}

foreach ($name in @("code", "cursor", "codium")) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { Add-Editor $cmd.Source }
}

$local = $env:LOCALAPPDATA
Add-Editor (Join-Path $local "Programs\Microsoft VS Code\bin\code.cmd")
Add-Editor (Join-Path $local "Programs\Microsoft VS Code\Code.exe")
Add-Editor (Join-Path $env:ProgramFiles "Microsoft VS Code\bin\code.cmd")
Add-Editor (Join-Path $local "Programs\cursor\resources\app\bin\cursor.cmd")
Add-Editor (Join-Path $local "Programs\VSCodium\bin\codium.cmd")

if ($editors.Count -eq 0) {
  Write-Host "[ERROR] No está VS Code, Cursor ni VSCodium en el PATH."
  Write-Host "        Instala VS Code y vuelve a abrir este archivo."
  exit 1
}

$ok = $false
foreach ($bin in $editors) {
  Write-Host "[INFO] Instalando en $bin..."
  & $bin --install-extension $vsix --force
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] ${bin}: fh-ia instalada"
    $ok = $true
  } else {
    Write-Host "[WARN] $bin no pudo instalar la extensión"
  }
}

if (-not $ok) {
  Write-Host "[ERROR] Ningún editor instaló fh-ia"
  exit 1
}

Write-Host ""
Write-Host "[OK] fh-ia instalada correctamente."
Write-Host "Abre VS Code / Cursor → icono fh-ia en la barra izquierda"
Write-Host "o Command Palette → fh-ia: Open Chat Panel"
