# Diferenciais do Rambutan Slicer

## Correções após a auditoria

- O painel de suportes e a revisão final compartilham a referência de início da varredura. Para uma peça acima da plataforma, o detector agora percorre as camadas vazias a partir de Z = 0. A primeira camada apoiada na plataforma ou no raft é tratada pelo mesmo classificador nos dois fluxos.
- Empates no contraventamento dos suportes usam a ordem geométrica das conexões. Os identificadores aleatórios continuam identificando as entidades.
- O teste do menu principal inclui a ação de diagnóstico de importação.

A leitura de `Untitled.step` pelo OCCT produziu uma malha com 1.120 triângulos. A comparação visual do carimbo requer a identificação do par STEP e PNG usado na reprodução original. O empacotamento Windows parou na etapa do Next.js com acesso negado ao canonicalizar o caminho do projeto.

Auditoria de código de 24 de novembro de 2026. A referência é o commit local `8bb1a22` do DragonFruit do qual o projeto derivou. A comparação inclui alterações locais em desenvolvimento. Uma implementação presente na árvore de trabalho pode ainda não fazer parte de uma release.

| Área | Diferencial identificado no fork | Onde verificar no código |
| --- | --- | --- |
| Importação CAD | Leitura de STEP/STP por OCCT em worker e conversão das malhas para a cena | `src/features/scene/stepGeometry.ts`, `stepImportWorkerClient.ts` |
| Diagnóstico de importação | Consulta dos diagnósticos da importação pelo menu principal | `src/components/layout/ImportDiagnosticsDialog.tsx`, `TopBar.tsx` |
| Carimbo experimental | Imagem como ferramenta de gravação ou relevo, projeção sobre a superfície, rotação e reposicionamento da prévia | `src/features/text-labels/`, `src/features/mesh-boolean/`, `TextLabelCard.tsx` |
| Orientação | Comparação de poses com análise da área das camadas em segundo plano | `src/supports/autoSupport/orientationLayerAnalysis.ts`, `orientationAdvisor.worker.ts` |
| Arranjo e alinhamento | Ampliação do arranjo de precisão existente e alinhamento da seleção | `src/features/scene/arrange/`, `src/features/scene/align/` |
| Corte orgânico | Registro das metades por espiga e alojamento e integração com histórico | `src/features/organicCut/`, [registro do corte](organic-cut-registration.md) |
| Cavidades | Preenchimento interno, processamento no fatiamento e verificação de comunicação dos furos com a cavidade | `src/features/hollowing/`, `src/features/slicing/sliceOnlyHollowing.ts`, `src/features/hole-punching/holePunchVerification.ts` |
| Suportes automáticos | Troncos em grade, ramificação e relatório por modelo com candidatos rejeitados e ilhas descobertas | `src/supports/autoSupport/`, `AutoSupportPanel.tsx` |
| Raft | Contorno em torno das bases dos suportes | `src/supports/Rafts/Crenelated/geometry/computeRaftFootprint.ts` |
| Colocação de contatos | Pintura sobre a superfície, projeção de padrões e distribuição em linha | `src/features/support-paint/`, `support-projection/`, `support-inline/` |
| Revisão de impressão | Inspeção de regiões flutuantes com modelo, suportes e raft, proximidade de hastes e detecção de ventosas | `src/features/support-check/`, `support-proximity/`, `suction-cups/`, `FinalPrintReview.tsx` |
| Inspeção dimensional | Medição entre pontos, ponto e plano ou planos paralelos, e detecção de colisões entre modelos | `src/features/measurement/`, `src/features/model-collision/` |
| Cena e perfis | Régua milimétrica, estatísticas do modelo, oclusão de ambiente na web e catálogo de impressoras | [régua](build-plate-millimeter-ruler.md), [oclusão](ambient-occlusion.md), `src/features/profiles/chituboxPrinterCatalog.ts` |
| Distribuição | Português brasileiro, identidade visual, instalador e créditos do fork | `src/locales/pt-BR.po`, `docs/brand/`, `src-tauri/tauri.conf.json` |

O teste de interface do menu principal acusa uma divergência na lista esperada de ações. O menu apresenta também a ação `Import diagnostics`.

## Achados de engenharia

1. **Contrato do fatiador.** O frontend envia `model_slice_ranges` e a camada Rust recebe o campo. Os 27 cenários de referência ainda esperavam a estrutura anterior. A correção registra o array vazio nesses cenários. O teste `sliceJobCrossing.test.ts` também cobre uma faixa com material configurado.
2. **Gravação.** O painel React calculava volume e fazia a interseção do raio com a malha em coordenadas da cena. Essas operações agora ficam em `solidMeshVolume.ts` e `engravingSurfacePicking.ts`. A mudança conserva o algoritmo de geração da geometria. A qualidade do contorno relatada pelo usuário exige validação visual com seu modelo e imagem.
3. **STEP.** A fila e o ciclo de vida do worker agora ficam em `stepImportWorkerClient.ts`. O ponto de entrada `parseStepGeometry` continua responsável por carregar a entrada e montar a geometria. O worker processa um pedido por vez.
4. **Revisão final.** A montagem da análise e a classificação dos pontos flutuantes saíram do componente React para `support-check/checkFinalPrintRegions.ts`. Há uma diferença de critério a validar em uma peça elevada: a revisão final usa o menor valor entre zero e a base da caixa envolvente, enquanto a verificação do painel de suportes usa a base da caixa. A refatoração conserva os critérios dos dois fluxos.

5. **Reprodutibilidade dos suportes automáticos.** A suíte registrou duas falhas de equivalência entre planos de posicionamento, com `window` ausente e com acesso a `window` monitorado. Os dois casos também falharam em uma execução isolada de `autoPlaceWorker.test.ts`. A comparação acusa diferenças no estado serializado. A causa e o impacto na geometria impressa permanecem em investigação. Em um teste distinto, a verificação de dois troncos independentes passou a desativar o contraventamento automático para medir somente a operação descrita pelo cenário.

O TypeScript passou na checagem estática. Os 77 testes focados de geometria, carimbo, suportes, colisões, medição e fatiamento passaram, assim como os 27 cenários de referência do contrato de fatiamento atualizado. A inspeção visual do carimbo, a importação em uma instalação empacotada e a impressão física são verificações distintas.
