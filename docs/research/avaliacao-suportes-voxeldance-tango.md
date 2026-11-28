# Avaliação de suportes: Voxeldance Tango e Rambutan-Slicer

**Revisão:** 27 de novembro de 2026
**Referência do Tango:** Voxeldance Tango 4.0 instalado nesta máquina
**Referência do Rambutan:** build candidata local `0.7.5`, baseada na tag oficial `v0.7.2` mais as alterações descritas abaixo

## Resumo executivo

O Tango oferece famílias prontas de suporte linear, árvore e geração inteligente, com perfis para figuras, peças mecânicas e miniaturas. A interface também expõe controle de contatos, limite de plataforma, estruturas internas, ligações entre suportes e perfurações.

O Rambutan-Slicer já tem uma base abrangente para geração automática e edição manual: perfis dimensionais, análise de ilhas, geração por grade e regiões, escopo interno/externo, ramificações, reforço automático, treliça lateral, edição e histórico. Ele não oferece a mesma seleção pronta de famílias `Bar/Tree/Smart`, nem todos os controles de cluster, diamante e ligação à plataforma observados no Tango. Nomes de controles semelhantes não significam que os algoritmos ou resultados sejam iguais.

Foi acrescentado ao Rambutan um alívio circular em grade para a placa sólida do raft. Ele preserva pontes de material entre aberturas, evita as bases dos suportes e não atua no raft de linhas. Também renomeei os quatro perfis de geração automática do Rambutan com nomes próprios, mantendo IDs e parâmetros antigos para compatibilidade.

## Método e limites da inspeção

- Observei o Tango 4.0 já aberto, com suportes previamente gerados. Em amostras distintas, a interface mostrou `Smart support-Figure` e `Bar support-Figure`; os valores de cada perfil estão identificados separadamente abaixo. Não gerei suportes, não salvei o projeto e não alterei a cena não salva.
- Registrei a lista de perfis visível na interface e os valores do painel ativo. Os nomes abaixo são os rótulos observados nessa instalação.
- Comparei os controles visíveis no Tango com as capacidades presentes no código do Rambutan. Nomes ou campos semelhantes não demonstram que os algoritmos, malhas ou resultados sejam equivalentes.
- Não copiei código, arquivos de preset, imagens ou recursos do Tango. A alteração do raft é uma implementação própria baseada em operações geométricas do Rambutan.
- Não validei a geometria com uma impressão física ou uma comparação controlada de arquivos fatiados. A build de produção do Next, TypeScript, verificação de imports de release e build nativo do Tauri passaram; a suíte de testes automatizados não foi executada nesta revisão.

## Tango: presets observados

O seletor apresentou estes 15 itens:

1. `Bar support-Figure`
2. `Bar support-Large size`
3. `Bar support-Medium size`
4. `Bar support-Small size`
5. `Tree support`
6. `AutomaticLogico Dragon Versatile 0.25 Tip`
7. `Smart support`
8. `Smart support-BJD`
9. `Smart support-Figure`
10. `Smart support-Gundam`
11. `Smart support-Heavy`
12. `Smart support-Miniature-100mm`
13. `Smart support-Miniature-30mm`
14. `Smart support-Miniature-50mm`
15. `Raft`

Com `Smart support-Figure` ativo, a interface mostrava ângulo crítico de **45°**, distância de ancoragem **2,5 mm**, ponta de **0,4 × 1,0 mm**, base e borda de **0,9 mm**, suporte em casca ativado e elevação Z de **5 mm**. O painel também apresentava explicação de ângulo crítico e opções de posição em relação à plataforma e a peças próximas.

### Inventário funcional dos controles do Tango

O painel principal observado para `Bar support-Figure` mostrava ângulo crítico **50°**, distância de ancoragem **2,3 mm**, ponta **0,38 mm**, larguras superior e inferior **1,2 mm**, suporte em casca ativado e elevação Z de **5 mm**. Em outra amostra, `Smart support-Figure` mostrava **45°**, **2,5 mm**, ponta **0,4 × 1,0 mm**, base e borda **0,9 mm**, casca ativada e elevação Z de **5 mm**. São valores associados aos perfis examinados, não padrões globais.

Na página **Anchor > Basic**, os controles visíveis incluíam distância de ancoragem **2,3 mm**, distância de borda **2,0 mm**, recuo de borda **0,5 mm** e afastamento de suporte **2,0 mm**, além do ângulo crítico. Em **Reinforce lowest points**, o reforço estava ligado e permitia ajustar distância de ancoragem do ponto inferior (**1,2 mm**) e altura de reforço (**1,5 mm**).

O inventário abaixo reúne famílias de condições identificáveis na versão examinada. Algumas são específicas de uma família ou perfil, e não necessariamente aparecem no painel de todos os 15 presets.

| Família de condição | Controles e variações identificáveis |
| --- | --- |
| **Detecção e posição** | Ângulo crítico; distância entre âncoras e da borda; recuo da borda; afastamento sem suporte; restrição dentro da plataforma; suporte em casca; evitar/localizar suportes vizinhos; reforçar pontos inferiores por raio de influência e intervalo; filtros de suportes curtos. |
| **Contato no modelo** | Conexões superior e inferior independentes; distância de contato dentro da peça; larguras superior/base; comprimento, largura, tipo e diâmetro da ponta; contato esférico, vertical ou dividido; pontos de quebra da conexão. |
| **Haste, barra e coluna sólida** | Contorno e tipo de contorno; larguras superior e inferior; espessura; raio; altura e altura de base; filete e tipo de filete; número de nervuras; número de lados poligonais; proporção altura/largura; ângulo de rotação; extensão máxima e nível de simplificação. |
| **Árvore e ramificações** | Limite de ramificações; larguras superior e inferior dos ramos e tronco; modo e altura máxima; ângulo máximo; número de nervuras e espessura; número de lados; posição e geometria das conexões cruzadas. |
| **Contorno e preenchimento interno** | Contorno e preenchimento ativáveis, com espessura e distância de parede; rotação; hachuras nos eixos X/Y; divisão em blocos; fragmentação X/Y por intervalo e comprimento; fragmentos separados; cruzamentos e ligação por dentes; sincronização e dentes completos nas extremidades; filtro de segmentos por comprimento e ângulo mínimos. |
| **Perfuração e alívio da estrutura** | Perfuração separada para contorno, preenchimento e rede; tipo de furo; altura sólida; dimensão, largura de feixe e ângulo de diamantes; raio de furo circular e raios superior/inferior; intervalo; altura de queda; remoção de furos sob balanços e deslocamento dos furos. |
| **Conexão à plataforma** | Conexão de plataforma ativável; altura, raio e ângulo de ranhura; limites de altura; dentes na ponta ou na plataforma, com distância, dimensões, intervalos, altura e larguras superior/base; base perfurada e dimensões de caixa delimitadora. |
| **Cluster e geometria facetada** | Comprimento por nível de cluster; larguras superior/inferior; largura, espessura de feixe e ângulo de diamantes; arestas poligonais; extensão máxima; razão altura/largura; ângulo de rotação e simplificação. |
| **Travessas, reforços e gussets** | Ligações cruzadas internas/entre barras; tipo e estilo; altura inicial; largura, ângulo e intervalos de conexão/fragmentação; reforço de contorno/hachura por direção, alcance, espaçamento e altura mínima/máxima; gussets com comprimentos mínimo/máximo, entalhe, intervalo, espessura, ângulo e limite de parede remota. |

Também foram identificadas famílias de geração para barra, linha, ponto, suporte sólido, reforço e apoio de pontos/arestas inferiores. A presença dessas famílias e dos controles nesta versão não demonstra que cada uma esteja disponível em todos os perfis, nem que os parâmetros gerem a mesma malha ou qualidade do Rambutan.

## Rambutan-Slicer: cobertura atual

### Funções existentes

- **Geração automática ajustável:** ângulo de auto-sustentação, área mínima de ilha, raio de influência da ponta, área atendida por suporte, limiar de grade, escala, densidade adaptativa, cobertura desejada e limites de ramificação.
- **Escopo de superfície:** combinado, exterior ou interior; reforço de mínimos e estabilização de pose podem ser ativados.
- **Geometria de suporte:** troncos, ramificações, folhas, galhos curtos, apoios em vão, reforços, stumps e kickstands. Os tipos e relações estão registrados em `supportTypeRegistry.ts`.
- **Restrições de superfície:** regiões de bloqueio pintadas para excluir a geração automática; a classificação de escopo interno/exterior é uma política Rambutan própria.
- **Reforço:** treliça lateral, ligações entre eixos, grades e otimização posterior de suportes gerados. O plano automático é calculado antes de ser aplicado e a sequência inteira forma uma ação de histórico.
- **Perfis:** quatro perfis automáticos nativos, além de presets criados pelo usuário, editáveis e intercambiáveis em JSON. O Support Studio mantém presets geométricos separados para dimensões de ponta, haste e raiz.
- **Raft antes desta revisão:** placa sólida ou rede de linhas, contorno por raízes ou casco convexo, chanfro, parede e borda crenelada, com recuo para evitar interseção com modelos que tocam a plataforma.

### Matriz de paridade

| Capacidade observada no Tango | Rambutan-Slicer | Avaliação | Observação e preset recomendado |
| --- | --- | --- | --- |
| Suportes lineares em tamanhos pequeno/médio/grande | Perfis dimensionais automáticos, hastes e apoios manuais | Parcial | Use `Filigree`, `Weave` ou `Buttress` conforme densidade e carga. Não há um gerador de barras separado com o mesmo comportamento. |
| Perfil de árvore | Troncos, ramos, folhas, bifurcações e treliça | Parcial | `Weave` com reforço automático é o ponto inicial. As regras de formação da árvore não foram demonstradas como equivalentes. |
| Geração inteligente geral | Geração automática com detecção de ilhas, ângulo, densidade, cobertura e escopo | Parcial/forte | `Weave` é o ponto de partida recomendado para peças gerais; ajuste a política à geometria. |
| Geração automática, colocação manual, remoção e gerenciamento de perfis | Geração automática/manual, edição, remoção e perfis salvos | Coberto no fluxo geral | O Rambutan cobre as ações de trabalho, mas não reproduz a seleção de famílias nem todos os campos especializados do Tango. |
| Regiões de exclusão de suporte pintadas | Bloqueadores sobre a superfície do modelo | Coberto no fluxo geral | O bloqueio de áreas existe; a UX e a interação com os demais controles são próprias do Rambutan. |
| Perfis específicos para BJD, figura e Gundam | Parâmetros e perfis de usuário podem ser ajustados; não há esses três presets nativos | Parcial | Crie perfis locais `Forma Orgânica`, `Figura Detalhada` e `Estrutural Mecânica`, derivados de `Weave` e calibrados para cada classe. São sugestões de nome, não presets fornecidos. |
| Presets por altura de miniatura (30/50/100 mm) | Escala de suporte e parâmetros dimensionais ajustáveis; não há presets por altura | Parcial | Para começar, associe miniaturas pequenas a `Filigree`, médias a `Weave` e maiores a `Buttress`; valide ponta, altura e carga por modelo. |
| Ponta de 0,25 mm | Support Studio permite dimensão de contato configurável; perfil `Detail` atual usa 0,22 mm | Parcial | Um perfil de usuário `Ponta Fina` pode partir de `Detail`; não assuma que 0,22 mm reproduz uma ponta de 0,25 mm. |
| Limite à plataforma e busca em peças próximas | Verificações de colisão, plataforma e alvo existem em fluxos distintos | Parcial | Há restrições geométricas, mas não foi provado que têm as mesmas opções ou ordem de prioridade do Tango. |
| Suporte em casca e áreas internas | Escopo `interior` e parâmetros de geração existem | Parcial | `Hollow Core` é o preset Rambutan recomendado para superfícies interiores; não há controle chamado “suporte em casca” com equivalência comprovada. |
| Cluster, malha de diamantes e perfuração do corpo | Grade e treliça são configuráveis; há alívio circular no raft, mas não gerador de corpo interno perfurado/cluster/diamante | Parcial | É a principal lacuna estrutural: exige corpo de suporte próprio, com parâmetros de parede, passo e conectores, além de validação de malha. O alívio do raft não cobre essa função. |
| Ligações entre topo, base e plataforma, com contato esférico/vertical/dividido e dentes | Pontas, raízes, hastes e ramificações podem ser editadas; há verificações de colisão | Parcial | O Rambutan ainda não expõe de forma unificada tipos independentes de contato, dimensões de dente e as conexões à plataforma observadas. |
| Contorno, preenchimento, fragmentação por eixos e filtros de segmentos | Geração por grade, região, cobertura e reforço | Parcial | Não há editor equivalente para a composição de casca, hachura e fragmentação por eixo descrita no inventário. |
| Árvore com perfil de ramificação e conexão cruzada por família | Ramos e treliça podem ser gerados/ajustados | Parcial | Há fundamentos estruturais, mas faltam controles explícitos por família para contagem, dimensões, ângulo, altura e cruzamentos. |
| Gussets e reforço da parede remota | Treliça lateral, ligações e braces automáticos | Parcial | Reforço existente não oferece os parâmetros de gusset e parede remota identificados no Tango. |
| Raft com contorno, parede e linhas | Contorno/casco, parede e rede de linhas já existiam | Coberto em modos diferentes | O Rambutan fornece mais de um modo de footprint, sem alegação de geometria idêntica à do Tango. |
| Aberturas de alívio na placa do raft | Implementado nesta revisão para placas sólidas | Parcial | Aberturas circulares em grade, ponte mínima de 0,8 mm, afastamento das raízes e limite de 2.500 aberturas. Não modifica o raft de linhas. |

## Nomes próprios e relação de presets para o Rambutan

Os nomes visíveis deixaram de usar os genéricos anteriores e não reproduzem os rótulos do Tango. Os IDs internos continuam estáveis para preservar armazenamento, importações e atalhos.

| Novo nome exibido | ID compatível mantido | Uso recomendado | Relação de intenção com o Tango |
| --- | --- | --- | --- |
| **Filigree** | `light` | Peças pequenas ou detalhadas; menor densidade de posicionamento e banda dimensional delicada | Ponto de partida para `Bar support-Small size` e miniaturas de 30 mm |
| **Weave** | `medium` | Uso geral; equilíbrio entre cobertura e quantidade de suportes | Ponto de partida para árvore/geração inteligente geral, figuras, BJD e miniaturas de 50 mm |
| **Buttress** | `heavy` | Peças maiores, cargas altas ou regiões com risco de falha | Ponto de partida para `Bar support-Large size`, `Smart support-Heavy` e miniaturas de 100 mm |
| **Hollow Core** | `interior-pillar` | Superfícies interiores de modelos ocos, com escopo interior | Ponto de partida para estruturas internas; não substitui todas as opções de casca/conexão do Tango |

Essas relações são recomendações iniciais, não equivalências calibradas. `Filigree`, `Weave` e `Buttress` mantêm, respectivamente, os parâmetros anteriores de espaçamento/dimensionamento. Para o Tango `AutomaticLogico Dragon Versatile 0.25 Tip`, crie `Ponta Fina` no Support Studio com o contato medido para o material e a impressora. Para BJD, figura e Gundam, salve variantes próprias em vez de dar aos presets nativos nomes que pareçam cópias.

## Alteração executada: alívio de material no raft

O novo ajuste `Base relief` aplica aberturas circulares numa grade quadrada apenas quando o raft usa a placa sólida. As posições são calculadas a partir do footprint já respeitando o clearance dos modelos. A erosão do footprint mantém ao menos **1,8 mm** de material até a borda para a abertura padrão de 2 mm; o afastamento das raízes também preserva **0,8 mm** de ponte adicional. O pitch é sempre pelo menos o diâmetro mais a ponte mínima.

Valores iniciais: recurso desligado, diâmetro de 2 mm e pitch de 6 mm. O estado antigo recebe esses defaults ao ser normalizado, e o valor desligado mantém a geometria anterior. A rotina limita a quantidade de cortes e aumenta o pitch de forma determinística quando o footprint for excepcionalmente grande.

O footprint calculado é compartilhado por prévia, estimativa de resina, exportação e fatiamento. Assim, a mesma geometria de alívio chega ao preview e à saída. Uma validação de malha e uma comparação de impressão ainda são necessárias antes de recomendar um perfil físico.

Arquivos principais: `src/supports/Rafts/Crenelated/geometry/raftBaseRelief.ts`, `computeRaftFootprint.ts`, `RaftTypes.ts`, `RaftDefaults.ts`, `RaftState.ts` e `RaftSettingsCard.tsx`.

## Plano de engenharia

| Prioridade | Entrega | Critério de conclusão |
| --- | --- | --- |
| **P0 — referência comparável** | Preparar modelos fixos para miniatura, figura orgânica, peça mecânica e casca oca; manter impressora, resina, orientação e camada iguais nas comparações. | Registrar cobertura de ilhas, contatos rejeitados, colisões, volume de suporte, componentes desconectados, tempo de geração e resultado de remoção. Associar cada preset usado ao modelo e à configuração. |
| **P1 — primitivas de contato e plataforma** | Separar parâmetros de contato superior/inferior; suportar variantes esférica, vertical e dividida; expor conectores à plataforma, dentes e restrições de proximidade em fluxos manuais e automáticos. | Prévia, salvamento/restauração do perfil e exportação preservam os mesmos parâmetros; suportes respeitam superfície, plataforma, regiões bloqueadas e geometria vizinha. |
| **P1 — famílias estruturais** | Implementar representações próprias para barra/coluna, rede interna e cluster; adicionar passo, espessura, contorno, conexões e perfuração como parâmetros independentes. | Malhas fechadas e válidas em geometrias côncavas e componentes separados; parâmetros reproduzíveis após salvar e reabrir; comparação de volume e rigidez com a referência. |
| **P2 — ramificação e reforço avançados** | Evoluir a árvore com limites dimensionais de ramo/tronco, travessas, gussets e reforços localizados. | A geração mantém ângulos e comprimentos dentro dos limites definidos, evita interseções com o modelo e cria ligações contínuas entre membros. |
| **P2 — presets calibrados** | Ajustar `Filigree`, `Weave`, `Buttress`, `Hollow Core` e os perfis locais sugeridos em modelos e impressoras documentados. | Cada perfil inclui objetivo, material/configuração usados, limites conhecidos e validação geométrica/física. Não promover equivalência com outro produto apenas pelo nome ou aparência. |
| **P0 — raft com alívio** | Validar o novo alívio em footprints côncavos, múltiplos componentes e raízes próximas. | Malha fechada, normais consistentes, clearance preservado e mesma geometria em prévia, estimativa, exportação e fatiamento; confirmar em impressão antes de recomendar parâmetros. |

A sequência começa pela referência de comparação para orientar a arquitetura e os parâmetros. O alívio do raft já foi implementado; a validação listada é o próximo gate antes de uso recomendado em produção.

## Artefato local desta revisão

A build Windows x64 `0.7.5` gerou executável, MSI e NSIS do mesmo código-fonte. A checagem TypeScript e a verificação de imports da build de produção passaram: foram abertos `.stl`, `.obj`, `.3mf`, `.step`, `.stp`, `.zip`, `.voxl`, `.chitubox`, `.ctp` e `.lys`, além de cenas `.zip`; o diagnóstico de um STEP inválido também foi confirmado. O OBJ grande que motivou a correção ainda precisa ser reaberto no aplicativo instalado.

| Artefato local | Caminho | SHA-256 |
| --- | --- | --- |
| Executável 0.7.5 | `rambutan-slicer.exe` | `679B5497A0AF17F8FB1801D102F7368044416B4222BEB6F55AFAAC022FDABA3C` |
| Instalador MSI 0.7.5 | `Rambutan Slicer_0.7.5_x64_en-US.msi` | `3941F47204F5AA49FD2DD5A9A180F1B4CE2F1C09A0E47F0A2E377B58E151F50C` |
| Instalador NSIS 0.7.5 | `Rambutan Slicer_0.7.5_x64-setup.exe` | `1E70B18F07DFAE91771B5C566E0680D97439B300722A14076592B93208FEA783` |

A versão do executável e dos dois instaladores é `0.7.5`. Esta build local ainda não foi publicada como release.
