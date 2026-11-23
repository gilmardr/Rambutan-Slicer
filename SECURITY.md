# Política de segurança

## Versões com suporte

O Rambutan Slicer ainda está em pré-lançamento. Correções de segurança são aplicadas
somente ao branch `main`.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para problemas de segurança.

Use o reporte privado do GitHub: na página do repositório, abra
**Security → Report a vulnerability**. Inclua:

- a versão (copie a linha de **Configurações → Sobre**) e o sistema operacional;
- os passos para reproduzir e o impacto esperado;
- um arquivo de exemplo (cena, modelo ou arquivo de impressão), se for relevante.

Você deve receber uma resposta inicial em até 7 dias. Se a falha também existir no
DragonFruit, ela será encaminhada ao [projeto original](https://github.com/Open-Resin-Alliance/DragonFruit)
de forma responsável, com o seu consentimento.

## Escopo

Interessam especialmente:

- execução de comandos ou programas a partir de arquivos, plugins ou URLs;
- leitura ou escrita de arquivos fora das pastas escolhidas pelo usuário;
- arquivos de impressão gerados de forma que possam danificar a impressora.

Problemas de qualidade de impressão sem impacto de segurança devem ser reportados como
issue comum.
