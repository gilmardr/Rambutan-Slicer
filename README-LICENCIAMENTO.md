# Licenciamento e notas de conformidade

Este arquivo registra a base de licenciamento do Rambutan Slicer e os cuidados
de distribuição conhecidos. Ele não é parecer jurídico nem certificação de que
cada arquivo e dependência passou por uma auditoria jurídica completa.

## Licença do aplicativo

O Rambutan Slicer é um fork derivado do DragonFruit. O repositório upstream
declara **GNU Affero General Public License, versão 3 ou posterior
(AGPL-3.0-or-later)** para o conteúdo principal, salvo diretórios e submódulos
com licença própria. A raiz deste repositório mantém essa licença no arquivo
[`LICENSE`](LICENSE) e declara as modificações no [`README.md`](README.md).

Por isso, este repositório **não declara o aplicativo inteiro como GPL-3.0-only**.
Trocar o texto da licença para GPL-3.0-only não retiraria os direitos dos
titulares do DragonFruit nem autorizaria relicenciar o código upstream. Uma
licença GPLv3-only para o conjunto exigiria autorização expressa dos titulares
de todos os trechos upstream relevantes, além da compatibilidade das demais
dependências. Sem essa autorização, mantenha AGPL-3.0-or-later e cumpra seus
termos ao publicar o código, binários ou uma instância modificada oferecida pela
rede.

As contribuições originais do Rambutan podem ter seus próprios avisos de autoria,
mas a distribuição do aplicativo combinado continua sujeita às obrigações da
licença do código DragonFruit incorporado. Só os titulares de cada contribuição
podem conceder direitos adicionais sobre ela.

## Avisos de modificação e atribuição

- Preserve o arquivo [`LICENSE`](LICENSE), avisos de copyright e atribuições do
  DragonFruit e de outros titulares.
- Mantenha no [`README.md`](README.md) a identificação do upstream e o aviso de
  que o projeto foi modificado.
- Não apresente o Rambutan como produto oficial da Open Resin Alliance nem use
  marcas ou identidade visual de terceiros de forma que sugira endosso.
- Distribuições compiladas devem vir acompanhadas do código-fonte correspondente
  e dos demais materiais exigidos pela licença aplicável. Consulte a AGPLv3,
  inclusive a seção 13 para interação remota com uma versão modificada.

## Plugins, submódulos e dependências

Os plugins incluídos como submódulos declaram licenças próprias; os arquivos
`LICENSE` presentes nos plugins atualmente verificados declaram MIT. Isso não
substitui a licença do aplicativo principal. Antes de cada release, confira a
licença no commit exato de cada submódulo e mantenha os avisos exigidos. As
dependências npm, Rust e outros ativos também podem ter termos próprios; este
arquivo não substitui a revisão de seus avisos.

## Análise de concorrentes e REA

O uso do REA para observar documentação, interfaces ou artefatos de outros
programas não transfere código desses programas para este repositório nem altera
a licença do Rambutan. A implementação deve permanecer independente: não copie
código-fonte, pseudocódigo decompilado, imagens, ícones, textos ou outros ativos
proprietários de Lychee, CHITUBOX ou VoxelDance. Registre fatos funcionais e use
fontes públicas para comparação, sem apresentar análise estática como prova de
paridade ou de autorização para redistribuir artefatos examinados.

Os relatórios de comparação são notas de pesquisa; a presença de um relatório
não demonstra, por si só, que todo o código do aplicativo foi auditado. Antes de
uma publicação comercial, uma revisão jurídica do histórico de alterações,
submódulos, dependências, marcas e materiais derivados é recomendável.

No Brasil, a Lei nº 9.609/1998 enumera situações específicas que não constituem
ofensa aos direitos do titular de programa de computador. Ela não deve ser lida
como autorização genérica para copiar ou redistribuir código proprietário obtido
por engenharia reversa. A Lei nº 9.610/1998 exclui ideias, procedimentos,
sistemas e métodos como tais da proteção autoral, mas isso não autoriza copiar a
expressão concreta protegida de outra obra. A aplicação dessas regras depende dos
fatos, dos contratos aceitos e da jurisdição pertinente.

## Fontes

- [DragonFruit — repositório e licença upstream](https://github.com/Open-Resin-Alliance/DragonFruit)
- [GNU AGPL versão 3](https://www.gnu.org/licenses/agpl-3.0.html)
- [GNU FAQ — GPL, AGPL, compatibilidade e relicenciamento](https://www.gnu.org/licenses/gpl-faq.html)
- [Lei nº 9.609/1998 — Lei do Software (Câmara dos Deputados)](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html)
- [Lei nº 9.610/1998 — Direitos Autorais (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm)
