<p align="center">
  <img src="public/splash-hero.jpg" alt="Rambutan Slicer" width="720">
</p>

<h1 align="center">Rambutan Slicer</h1>

<p align="center">
  Slicer de resina para impressão 3D (MSLA/DLP), de código aberto, derivado do
  <a href="https://github.com/Open-Resin-Alliance/DragonFruit">DragonFruit</a> da Open Resin Alliance.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licença: AGPL-3.0-or-later" src="https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0--or--later-blue"></a>
  <a href="https://github.com/gilmardr/Rambutan-Slicer/releases"><img alt="Última versão" src="https://img.shields.io/github/v/release/gilmardr/Rambutan-Slicer?include_prereleases&label=vers%C3%A3o"></a>
  <a href="https://github.com/Open-Resin-Alliance/DragonFruit"><img alt="Baseado no DragonFruit" src="https://img.shields.io/badge/baseado%20no-DragonFruit-e0115f"></a>
</p>

> **Aviso de modificação (AGPL-3.0, seção 5a):** este trabalho é uma versão modificada do DragonFruit, derivada do commit upstream [`8bb1a22`](https://github.com/Open-Resin-Alliance/DragonFruit/commit/8bb1a22657b8c004f935f9ea7925fb0d8bc4d1a9). Modificado por Gilmar Afonso Druciak a partir de novembro de 2026 (rebranding, novas ferramentas de suporte, medição, corte orgânico, hollowing e documentação). O histórico completo das alterações está no log do Git deste repositório.

> [!WARNING]
> O Rambutan Slicer é baseado em um projeto em desenvolvimento ativo. Valide os arquivos gerados antes de usá-los em impressões de produção e evite imprimir sem acompanhamento no primeiro uso.

## Sumário

- [Download](#download)
- [Funcionalidades](#funcionalidades)
- [Começando](#começando)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Documentação](#documentação)
- [Contribuindo](#contribuindo)
- [Créditos](#créditos)
- [Licença](#licença)

## Download

Os instaladores ficam na página de [Releases](https://github.com/gilmardr/Rambutan-Slicer/releases):

- **Windows:** `Rambutan Slicer_<versão>_x64-setup.exe`.
- **macOS e Linux:** ainda sem instalador publicado; compile a partir do código-fonte (veja [Começando](#começando)).

Como exige a AGPL, o código-fonte correspondente a cada versão está neste repositório, na tag da release.

## Funcionalidades

Herdadas do DragonFruit:

- **Workspace 3D interativo** com `three.js` e `react-three-fiber`.
- **Transformações** mover, rotacionar e escalar com controles de precisão e gizmos.
- **Análise de ilhas e de volume** para encontrar regiões sem suporte camada a camada.
- **Suportes** em árvore, grade e raft, com posicionamento manual e automático.
- **Reparo de malha** e **fatiamento nativo em Rust**, com exportação para vários formatos de impressora por plugins.
- **App desktop via Tauri**, com perfis de impressora e material.

Adicionadas no Rambutan Slicer:

- **Auto-suporte em grade por padrão**, com tocos compactos perto da plataforma e relatório por modelo (candidatos rejeitados e ilhas sem cobertura).
- **Verificação de regiões flutuantes**, que fatia o modelo junto com os suportes.
- **Raft com contorno** que acompanha as bases dos suportes.
- **Auto-orientação** com análise de camadas em segundo plano.
- **Arranjo de alta precisão** e alinhamento dos modelos selecionados.
- **Gravação de texto** na superfície do modelo, além de medição, corte orgânico e hollowing.
- **Interface traduzida** para português do Brasil, inglês, espanhol, francês, alemão, tcheco e eslovaco.

## Começando

### Submódulos de plugins

Os plugins de impressora ficam em submódulos Git (por exemplo `plugins/ctb`). Clone com `git clone --recurse-submodules` ou rode `git submodule update --init --recursive` depois. Se algum submódulo faltar, o build continua com os plugins disponíveis e avisa quais ficaram de fora.

### Desenvolvimento da interface (Next.js)

Para trabalhar só na interface, sem o app desktop:

1. Instale o Node.js (versão em `.nvmrc`) e o npm.
2. Na raiz do repositório, rode `npm install`.
3. Inicie o servidor com `npm run dev`.
4. Abra `http://localhost:3005`.

### Desenvolvimento desktop (Tauri + Rust)

1. Instale o Node.js, a toolchain Rust (versão em `rust-toolchain.toml`) e as [dependências do Tauri](https://tauri.app/start/prerequisites/) para o seu sistema.
2. Rode `npm install`.
3. Inicie com `npm run tauri:dev`. Alterações na interface e no Rust são testadas pelo mesmo fluxo.

### Build de produção

1. **Frontend:** `npm run build` (ou `npm run build:tauri` para os artefatos do Tauri).
2. **Desktop:** `npm run tauri:build`.
3. **Instaladores:** `npm run tauri:bundle` para a máquina atual, ou um alvo específico:
   - `npm run tauri:bundle:windows`
   - `npm run tauri:bundle:linux`
   - `npm run tauri:bundle:macos:universal`: `.dmg` universal para Intel e Apple Silicon.
   - `npm run tauri:bundle:macos` / `npm run tauri:bundle:macos:arm64`: atalhos de uma arquitetura, só para desenvolvimento local.

## Estrutura do projeto

- `src/` — app Next.js: componentes React, cena 3D, sistemas de suporte, hooks, catálogos de tradução e utilitários.
- `src-tauri/` — host desktop Tauri e integração nativa.
- `rust/` — crates nativos: fatiamento, reparo de malha, ilhas, corte orgânico, CLI e outros.
- `plugins/` — plugins de impressoras e integrações (licenças próprias).
- `profiles/` — perfis de impressora e material.
- `docs/` — guias de uso, referência, documentação de desenvolvimento e decisões de arquitetura (`docs/adr/`).

## Documentação

- [Guia de uso e referência](docs/index.md)
- [Guia de desenvolvimento](DEVELOPMENT.md) — regras do projeto, i18n, lint, histórico de desfazer/refazer e versões dos crates.
- [Localização (i18n)](docs/dev/localization.md)
- [Glossário do domínio](CONTEXT.md)

## Contribuindo

Contribuições são bem-vindas. Leia o [guia de contribuição](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md) antes de abrir um pull request. Falhas de segurança devem ser reportadas de forma privada, conforme a [política de segurança](SECURITY.md).

Se o problema também existe no DragonFruit, considere corrigi-lo no [projeto original](https://github.com/Open-Resin-Alliance/DragonFruit).

## Créditos

O Rambutan Slicer só existe graças ao trabalho de outras pessoas:

- **[DragonFruit](https://github.com/Open-Resin-Alliance/DragonFruit)**, da **[Open Resin Alliance](https://github.com/Open-Resin-Alliance)** e de todos os seus [colaboradores](https://github.com/Open-Resin-Alliance/DragonFruit/graphs/contributors): a base de todo o aplicativo, do workspace 3D ao motor de fatiamento. O histórico de commits deles está preservado neste repositório.
- **[TetGen](https://codeberg.org/TetGen/TetGen)**, de Hang Si e do WIAS Berlin (AGPL-3.0), usado na malha tetraédrica.
- **Plugins de impressora** em `plugins/`, cada um com seus autores e licença (MIT nos plugins verificados).
- **Bibliotecas de código aberto**, entre elas [three.js](https://threejs.org/), [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [Next.js](https://nextjs.org/), [React](https://react.dev/), [Tauri](https://tauri.app/), [Lingui](https://lingui.dev/), [Manifold](https://github.com/elalish/manifold), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), [Zustand](https://github.com/pmndrs/zustand) e [Lucide](https://lucide.dev/). As licenças de cada dependência estão nos respectivos pacotes.
- **Tradutores** do DragonFruit e do Rambutan Slicer.

Para apoiar o projeto original, veja o [Open Collective da Open Resin Alliance](https://opencollective.com/openresinalliance).

## Licença

A menos que um subdiretório ou submódulo declare o contrário, o Rambutan Slicer é licenciado sob a **GNU Affero General Public License, versão 3 ou posterior (AGPL-3.0-or-later)**, a mesma do DragonFruit. Veja o arquivo [`LICENSE`](LICENSE) para os termos completos.

Os submódulos de plugins em `plugins/` têm licença própria, declarada no `LICENSE` de cada repositório.

O [README-LICENCIAMENTO.md](README-LICENCIAMENTO.md) explica a relação com a licença upstream, os avisos de modificação e as obrigações ao distribuir o aplicativo.

---

<sub>Rambutan Slicer é um fork independente do DragonFruit e não é um produto oficial da Open Resin Alliance. Todos os créditos upstream estão preservados conforme a AGPL-3.0-or-later.</sub>
