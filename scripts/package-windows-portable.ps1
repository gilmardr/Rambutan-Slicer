#Requires -Version 5.1
<#
.SYNOPSIS
Cuts the standalone executable and the portable zip from a finished Windows build.
.DESCRIPTION
Tauri embeds the whole frontend in the application executable, so the same
binary the installer ships runs from any folder. This script copies it out as

  Rambutan-Slicer_<version>_<arch>.exe            the executable on its own
  Rambutan-Slicer_<version>_<arch>_portable.zip   a folder to extract and run

The zip carries the AGPL license, the third-party notices the build generated
(public/THIRD-PARTY-NOTICES.txt) and a short LEIA-ME/README. The .voxl
thumbnail extension is left out: it only works once registered, which is what
the installer is for. Settings still live in the user's AppData folders.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('x86_64-pc-windows-msvc', 'i686-pc-windows-msvc')][string]$Triple,
    [Parameter(Mandatory)][ValidateSet('x64', 'x86')][string]$Arch,
    [Parameter(Mandatory)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$manifest = Get-Content -LiteralPath (Join-Path $root 'src-tauri/Cargo.toml') -Raw
$packageName = [regex]::Match($manifest, '(?m)^name\s*=\s*"([^"]+)"').Groups[1].Value
if (-not $packageName) { throw 'Could not read the Tauri executable name from Cargo.toml.' }

$exe = Join-Path $root "src-tauri/target/$Triple/release/$packageName.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Built executable not found: $exe" }
$notices = Join-Path $root 'public/THIRD-PARTY-NOTICES.txt'
if (-not (Test-Path -LiteralPath $notices -PathType Leaf)) { throw "Third-party notices not found: $notices (prebuild:tauri generates them)." }
$license = Join-Path $root 'LICENSE'

[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$base = "Rambutan-Slicer_${version}_${Arch}"

Copy-Item -LiteralPath $exe -Destination (Join-Path $OutputDirectory "$base.exe") -Force

if ($Arch -eq 'x64') {
    $runtimePt = 'Precisa do Microsoft Visual C++ Redistributable x64 (https://aka.ms/vc14/vc_redist.x64.exe). Se o Rambutan Slicer ja foi instalado pelo instalador x64 neste computador, ele ja esta instalado.'
    $runtimeEn = 'Needs the Microsoft Visual C++ Redistributable x64 (https://aka.ms/vc14/vc_redist.x64.exe). If the x64 installer has run on this computer, it is already there.'
} else {
    $runtimePt = 'O runtime do Visual C++ ja vem dentro do executavel; nao precisa instalar nada alem do WebView2.'
    $runtimeEn = 'The Visual C++ runtime is built into the executable; nothing to install besides WebView2.'
}
$readme = @"
Rambutan Slicer $version - versao portable ($Arch)
================================================

NAO TESTADA: esta versao so foi compilada pelo CI. O unico pacote testado e o
instalador x64. Relate problemas em https://github.com/gilmardr/Rambutan-Slicer/issues

Como usar: extraia a pasta inteira e abra "Rambutan Slicer.exe".

Requisitos:
- Windows 10 ou 11 com Microsoft Edge WebView2 (ja vem instalado nesses sistemas;
  senao: https://go.microsoft.com/fwlink/p/?LinkId=2124703).
- $runtimePt

Observacoes:
- As configuracoes ficam na pasta AppData do usuario, como na versao instalada.
- As miniaturas de arquivos .voxl no Explorer so existem na versao instalada.

Licenca: GNU AGPL v3 ou posterior (LICENSE.txt). Avisos e licencas de
terceiros: THIRD-PARTY-NOTICES.txt. Codigo-fonte:
https://github.com/gilmardr/Rambutan-Slicer

----------------------------------------------------------------------------

Rambutan Slicer $version - portable build ($Arch)

UNTESTED: this build only compiles in CI. Only the x64 installer has been
tested. Report problems at https://github.com/gilmardr/Rambutan-Slicer/issues

Usage: extract the whole folder and run "Rambutan Slicer.exe".

Requirements:
- Windows 10 or 11 with Microsoft Edge WebView2 (preinstalled there).
- $runtimeEn

Settings are stored in the user's AppData folders, as with the installed
build. Explorer thumbnails for .voxl files come only with the installer.

License: GNU AGPL v3 or later (LICENSE.txt). Third-party notices and licenses:
THIRD-PARTY-NOTICES.txt. Source: https://github.com/gilmardr/Rambutan-Slicer
"@

$staging = Join-Path ([IO.Path]::GetTempPath()) ('rambutan-portable-' + [Guid]::NewGuid().ToString('N'))
$folder = Join-Path $staging 'Rambutan Slicer'
[void](New-Item -ItemType Directory -Path $folder -Force)
try {
    Copy-Item -LiteralPath $exe -Destination (Join-Path $folder 'Rambutan Slicer.exe')
    Copy-Item -LiteralPath $notices -Destination (Join-Path $folder 'THIRD-PARTY-NOTICES.txt')
    Copy-Item -LiteralPath $license -Destination (Join-Path $folder 'LICENSE.txt')
    # CRLF so Notepad on older Windows shows the lines.
    [IO.File]::WriteAllText((Join-Path $folder 'LEIA-ME.txt'), ($readme -replace "`r?`n", "`r`n"), [Text.UTF8Encoding]::new($true))

    $zip = Join-Path $OutputDirectory "${base}_portable.zip"
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel Optimal
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

Get-ChildItem -LiteralPath $OutputDirectory | ForEach-Object { Write-Host "[portable] $($_.Name) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
