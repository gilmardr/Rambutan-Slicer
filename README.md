# Rambutan Slicer

> Downstream build of [DragonFruit](https://github.com/Open-Resin-Alliance/DragonFruit) — Open Resin Alliance · AGPL-3.0-or-later

Rambutan Slicer é um fork editável do DragonFruit, o slicer de resina de código aberto da Open Resin Alliance. Mantém a licença AGPL-3.0-or-later e a atribuição upstream. O app desktop combina frontend Next.js + React com backends de fatiamento nativos em Rust e runtime Tauri.

A menos que um subdiretório ou submódulo declare o contrário, o conteúdo Rambutan Slicer neste repositório é licenciado sob **AGPL-3.0-or-later**.

> **Aviso de modificação (AGPL-3.0, seção 5a):** este trabalho é uma versão modificada do DragonFruit, derivada do commit upstream [`8bb1a22`](https://github.com/Open-Resin-Alliance/DragonFruit/commit/8bb1a22657b8c004f935f9ea7925fb0d8bc4d1a9). Modificado por Gilmar Afonso Druciak a partir de novembro de 2026 (rebranding, novas ferramentas de suporte, medição, corte orgânico, hollowing e documentação). O histórico completo das alterações está no log do Git deste repositório.

> ⚠️ **Este build do Rambutan Slicer é baseado em um projeto em desenvolvimento ativo. Valide os outputs antes de usar em fluxos de impressão em produção e evite impressão desacompanhada no primeiro uso.**

## Sumário

- [Sobre o DragonFruit](#sobre-o-dragonfruit)
- [Funcionalidades](#funcionalidades)
- [Começando](#começando)
  - [Variante 1: Desenvolvimento frontend (Next.js)](#variante-1-desenvolvimento-frontend-nextjs)
  - [Variante 2: Desenvolvimento desktop (Tauri + Rust)](#variante-2-desenvolvimento-desktop-tauri--rust)
  - [Variante 3: Build de produção e bundling](#variante-3-build-de-produção-e-bundling)
- [Localização (i18n)](docs/dev/localization.md)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Sobre o DragonFruit

O DragonFruit foca em fluxos práticos de preparação de impressão em resina, incluindo inspeção de modelos, análise de ilhas, ferramentas de transformação, autoria de suportes e integração de fatiamento nativo. É projetado como uma toolchain desktop-first mantendo o frontend altamente iterativo para desenvolvimento rápido de features.

## Funcionalidades

O Rambutan Slicer inclui um conjunto crescente de capacidades para impressão 3D em resina:

- **Workspace 3D Interativo:** Visualização e manipulação de modelos de alto desempenho usando `three.js` + `react-three-fiber`.
- **Ferramentas de Transformação Avançadas:** Fluxos Move/Rotate/Scale com controles de precisão e gizmos de viewport.
- **Análise de Ilhas e Ferramentas de Volume:** Detecção e análise de regiões sem suporte por camada.
- **Sistemas de Autoria de Suportes:** Fluxos de suporte branch/grid/raft com infraestrutura de renderização e snapping.
- **Runtime Desktop via Tauri:** Pipeline de app desktop nativo com integração de backend Rust.
- **Arquitetura Extensível:** Sistemas de plugins e perfis para materiais, impressoras e integrações de ecossistema.

## Começando

Escolha uma das variantes abaixo de acordo com seu fluxo de trabalho.

### Nota sobre submódulos (desenvolvimento de plugins)

O DragonFruit suporta plugins como submódulos Git (por exemplo `plugins/ctb`). Se sua clone local estiver com pastas de plugins faltando, o build continuará com os plugins disponíveis (submódulos ausentes são ignorados com avisos). Inicialize/atualize os submódulos quando precisar desenvolver ou validar integrações específicas de plugins.

### Variante 1: Desenvolvimento frontend (Next.js)

Para desenvolvimento de UI e interação apenas (sem empacotamento desktop completo):

1. **Pré-requisitos:** Instale Node.js (LTS recomendado) e npm.
2. **Instale dependências:** Na raiz do repositório, execute `npm install`.
3. **Execute o servidor dev:** Inicie com `npm run dev`.
4. **Abra no navegador:** Acesse `http://localhost:3005`.

### Variante 2: Desenvolvimento desktop (Tauri + Rust)

Para desenvolvimento desktop completo com ligação do backend nativo:

1. **Pré-requisitos:** Instale Node.js, toolchain Rust e dependências de sistema Tauri para sua plataforma.
2. **Instale dependências JS:** Execute `npm install` na raiz do projeto.
3. **Execute o modo dev desktop:** Inicie com `npm run tauri:dev`.
4. **Itere entre as stacks:** Alterações no frontend e backend Rust podem ser testadas pelo mesmo fluxo dev do Tauri.

### Variante 3: Build de produção e bundling

Para builds e bundles estilo release:

1. **Build do frontend:** Execute `npm run build` (ou `npm run build:tauri` para artefatos Tauri preparados).
2. **Build desktop:** Compile binários desktop com `npm run tauri:build`.
3. **Bundle targets:** Use `npm run tauri:bundle` para o target da máquina atual. Targets específicos por plataforma:
   - `npm run tauri:bundle:windows`
   - `npm run tauri:bundle:linux`
   - `npm run tauri:bundle:macos:universal` — **target canônico macOS/release.** Produz um `.dmg` universal para Intel e Apple Silicon.
   - `npm run tauri:bundle:macos` / `npm run tauri:bundle:macos:arm64` — atalhos single-arch para dev local apenas.

## Estrutura do projeto

Layout de alto nível das principais áreas do projeto:

- `docs/` — Notas de arquitetura, guias de implementação e documentação de domínio.
- `plugins/` — Arquitetura de plugins e integrações de ecossistema (veja LICENSE).
- `profiles/` — Definições de perfis de impressora e material.
- `rust/dragonfruit-slicing-engine/` — Workspace do backend slicer em Rust.
- `src/` — App Next.js, componentes React, controles de cena, sistemas de suporte, hooks, catálogos i18n e utilitários.
- `src-tauri/` — Host desktop Tauri e pontos de integração nativos.

## Contribuindo

Contribuições são bem-vindas e apreciadas!

1. **Fork do Repositório:** Crie um fork pessoal e uma branch para sua feature/fix.
2. **Implemente as Mudanças:** Mantenha as mudanças focadas e alinhadas com as convenções do projeto.
3. **Execute as Verificações:** Valide com `npm run lint` e `npm run test` onde aplicável.
4. **Envie um Pull Request:** Abra um PR com resumo claro, justificativa e notas de validação.

## Licença

A menos que declarado de outra forma em um subdiretório ou submódulo, o Rambutan Slicer é licenciado sob **AGPL-3.0-or-later**. Veja o arquivo `LICENSE` na raiz para os termos completos.

Os submódulos de plugins em `plugins/` são licenciados separadamente sob **MIT**. Cada repositório de plugin inclui seu próprio arquivo `LICENSE`.

---

*Rambutan Slicer é um fork downstream do [DragonFruit](https://github.com/Open-Resin-Alliance/DragonFruit) da Open Resin Alliance. Todo crédito upstream preservado conforme AGPL-3.0-or-later.*
