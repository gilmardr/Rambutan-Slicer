# Rambutan Slicer — kit de marca

Arquivos-fonte da identidade visual, gerados a partir de `brand-guidelines` (pasta `brand` no Google Drive).

| Arquivo | Uso |
|---|---|
| `rambutan-icon.svg` | Ícone (fruta em corte), fundo transparente — telas grandes, splash |
| `rambutan-icon-small.svg` | Ícone simplificado para 16–48 px (barra do app, favicon) |
| `rambutan-app-icon.svg` / `-small.svg` | Ícone do aplicativo sobre teal-900 (base de `src-tauri/icons`) |
| `rambutan-wordmark.svg` | "RAMBUTAN SLICER" em uma linha, para fundo escuro (app e placa 3D) |
| `rambutan-wordmark-light-bg.svg` | Mesmo wordmark para fundo claro |
| `rambutan-logo-horizontal*.svg` | Ícone + wordmark lado a lado (`-dark-bg` para fundo escuro) |
| `rambutan-logo-vertical*.svg` | Ícone acima do wordmark (`-dark-bg` para fundo escuro) |
| `installer-*.svg` | Artes do instalador (NSIS header/sidebar, fundo do DMG) |

Paleta: carmim `#D4537E` (ação/identidade), teal `#1D9E75` / `#04342C` (navegação/fundo), âmbar `#EF9F27` (estado/tempo).
Texto convertido em curvas a partir de Inter Medium/Regular — não depende de fonte instalada.

Para regerar: `python generate-brand-assets.py saida/` (requer `fonttools` e a fonte Inter instalada em
`/usr/share/fonts/opentype/inter/`; ajuste os caminhos `FONT_*` no topo do script no Windows).
