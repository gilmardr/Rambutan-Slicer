# Como contribuir

Obrigado pelo interesse em melhorar o Rambutan Slicer. Ao participar, você concorda em
seguir o [Código de Conduta](CODE_OF_CONDUCT.md).

## Antes de começar

- Procure nas [issues](https://github.com/gilmardr/Rambutan-Slicer/issues) se o assunto já
  está sendo discutido.
- Se o problema também acontece no DragonFruit, considere corrigi-lo no
  [projeto original](https://github.com/Open-Resin-Alliance/DragonFruit): assim todos se
  beneficiam e o fork fica mais fácil de manter.
- Para mudanças grandes, abra uma issue primeiro para combinar a abordagem.

## Fluxo de trabalho

1. Faça um fork e crie um branch a partir de `main` (`feat/...`, `fix/...`, `docs/...`).
2. Mantenha cada pull request focado em um único assunto.
3. Antes de enviar, rode as verificações:

   ```bash
   npm run lint
   npm run test
   npm run check:i18n-literals
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

4. Se mudou textos da interface, rode `npm run i18n:update` e inclua os catálogos.
5. Se mudou o fatiamento ou a exportação, descreva no PR como verificou o resultado
   (preview de camadas, arquivo aberto no UVtools, impressão de teste).

## Regras do projeto

- Textos da interface passam pelo Lingui (`msg`/`Trans`); não escreva texto fixo na UI.
- Documente mudanças de comportamento em `docs/` e decisões de arquitetura em `docs/adr/`.
  O guia de documentação está em [docs/dev/contributing.md](docs/dev/contributing.md).
- Regras do projeto e convenções técnicas (i18n, lint, desfazer/refazer, versões dos crates)
  estão no [guia de desenvolvimento](DEVELOPMENT.md).
- **Código limpo e de origem legítima:** não envie código, recursos ou dados copiados de
  software proprietário, nem obtidos por engenharia reversa de programas de terceiros.
  Comparações com outros produtos devem se basear apenas na documentação pública deles.
- Imagens e recursos de terceiros (fotos de impressoras, logotipos) só entram com
  permissão de redistribuição documentada.

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela seja distribuída sob a
AGPL-3.0-or-later, a mesma licença do projeto. Contribuições para os plugins seguem a
licença do respectivo plugin.
