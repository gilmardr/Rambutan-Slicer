# Histórico de versões

Cada versão lista o que há de novo e o que foi corrigido em relação à anterior.
A seção da versão também vira o texto da release no GitHub.

As notas seguem sempre a mesma ordem de prioridade: **Windows** primeiro,
depois **Linux** e por último **macOS**. O que vale para todas as plataformas
vem em "Todas as plataformas", depois das três. Uma plataforma sem mudanças
nesta versão aparece com "Nada específico nesta versão".

## [0.7.8] - 2026-11-27

### Todas as plataformas

- Sculpture Lattice usa raft de 0,40 mm com furos de 12 lados, 2 mm de diâmetro e passo de 3 mm. Fine Lattice mantém a raft de 0,50 mm. O padrão hexagonal permanece disponível.

## [0.7.7] - 2026-11-27

### Windows

Nada específico nesta versão.

### Linux

Nada específico nesta versão.

### macOS

Nada específico nesta versão.

### Todas as plataformas

- Corrige o fatiamento 3DAA dos suportes existentes: a penetração do perfil passa a ser usada somente para os novos contatos que a definem explicitamente ou para contatos esféricos.
- Inclui a comparação de suportes na navegação da documentação e corrige as referências a arquivos de build locais.
- Inclui os novos presets e os padrões de raft da 0.7.6.

## [0.7.6] - 2026-11-27

### Windows

- Gera instaladores EXE e MSI para Windows x64.

### Linux

Nada específico nesta versão.

### macOS

Nada específico nesta versão.

### Todas as plataformas

- Adiciona os presets **Sculpture Lattice** e **Fine Lattice** ao seletor de suportes automáticos. Os perfis funcionam com os modelos selecionados e ajustam a densidade, as pontas dos troncos e a treliça lateral.
- Adiciona dois padrões de raft perfurada com fileiras alternadas e permite ajustar o padrão nas configurações da raft. Os novos presets aplicam uma base de 0,50 mm à cena.
- Ajusta a geometria da ponta esférica na visualização e no fatiamento.
- A primeira publicação após a 0.7.2 também inclui as mudanças locais das versões 0.7.3 a 0.7.5, documentadas abaixo.

## [0.7.5] - 2026-11-27

### Windows

Nada específico nesta versão.

### Linux

Nada específico nesta versão.

### macOS

Nada específico nesta versão.

### Todas as plataformas

- A seleção e o arrastar-e-soltar de STL, OBJ e 3MF usam o carregador nativo por caminho e deixam de copiar o arquivo completo para o WebView.
- O painel de suportes automáticos passa a rolar dentro da área visível, mantendo o cabeçalho acessível em janelas menores.

## [0.7.4] - 2026-11-27

### Windows

- Corrige o travamento ao importar STL grande: a prévia reduzida não é classificada novamente no WebView.

### Linux

Nada específico nesta versão.

### macOS

Nada específico nesta versão.

### Todas as plataformas

Nada específico nesta versão.

## [0.7.3] - 2026-11-27

### Windows

Nada específico nesta versão.

### Linux

Nada específico nesta versão.

### macOS

Nada específico nesta versão.

### Todas as plataformas

**Suportes e raft**

- Os quatro presets automáticos receberam nomes próprios: Filigree, Weave, Buttress e Hollow Core. IDs e parâmetros foram mantidos para compatibilidade com configurações existentes.
- O raft sólido ganhou alívio circular configurável, com distância mínima entre aberturas e afastamento das raízes dos suportes. O recurso começa desligado; o modo de linhas não é alterado.
- A sincronização de versão agora atualiza o pacote Rambutan-Slicer pelo nome atual no Cargo.lock.

## [0.7.2] - 2026-11-27

### Windows

Nada específico nesta versão. A correção está em Todas as plataformas.

### Linux

Nada específico nesta versão. O Flatpak recebe as mudanças de Todas as plataformas.

### macOS

Nada específico nesta versão. O DMG recebe as mudanças de Todas as plataformas.

### Todas as plataformas

**Correções**

- **Treliça lateral dos suportes:** reduz conexões repetidas, impede diagonais que saltam células e alterna a orientação dentro de cada célula para não formar X sobre X.
- **Reforços verticais:** mantém a densidade de contatos calibrada para cobertura; a redução atua nas travessas laterais redundantes.
- **Preview técnico:** inclui vistas lateral e em perspectiva geradas pela geometria do algoritmo.

## [0.7.1] - 2026-11-26

### Windows

**Correções**

- **Instalador:** a tela do Microsoft Visual C++ e as mensagens dela diziam "DragonFruit". Agora dizem "Rambutan Slicer" e aparecem em português no Windows em português. As telas do instalador também ficaram em português.
- **Reinício no instalador:** quando o Visual C++ novo já está no disco, o instalador continua sem pedir para reiniciar. Só pede quando um arquivo em uso ficou para ser trocado.

### Linux

Nada específico nesta versão. O Flatpak recebe as mudanças de todas as plataformas abaixo.

### macOS

Nada específico nesta versão. O DMG recebe as mudanças de todas as plataformas abaixo.

### Todas as plataformas

**Novidades**

- **Etapas na lateral esquerda:** Preparar, Suporte, Exportar e Impressão saem do centro da barra do topo e passam para uma barra vertical à esquerda. A barra de ferramentas vertical, os painéis e o cartão de estatísticas do modelo abrem espaço para ela.
- **Paleta de comandos:** o menu do Rambutan Slicer virou uma paleta pesquisável com os arquivos recentes. Abre pelo botão do menu ou com Ctrl+K (Cmd+K no Mac).
- **Treliça lateral na diagonal:** a treliça automática agora também liga suportes vizinhos na diagonal da grade, deixando o conjunto mais rígido.

**Correções**

- **Painel de Slicing:** o painel agora rola quando não cabe na tela, e o botão de fatiar fica sempre visível no rodapé.
- **Nomes no app:** o tipo de arquivo VOXL e a mensagem de STL grande demais não falam mais em DragonFruit.

## [0.7.0] - 2026-11-26

### Windows

**Novidades**

- **Windows 32 bits e versões sem instalador:** além do instalador x64, a release traz instalador x86, executável avulso e versão portable (zip) para x64 e x86. Só o instalador x64 foi testado.

**Correções**

- **Build x86:** a biblioteca manifold passa a ser compilada para Win32 com o runtime estático, e a verificação dos pacotes do Windows aceita o Universal CRT.

### Linux

- A release e o README avisam que a versão Linux ainda não foi testada.

### macOS

- A release e o README avisam que a versão macOS só é compilada e nunca foi testada num Mac.

### Todas as plataformas

**Novidades**

- **Doações por Pix:** a tela Sobre e o menu do app têm a opção "Apoiar o Rambutan" com a chave Pix. O README e o botão Sponsor do GitHub também.
- **Importação STEP mais segura:** a conversão de arquivos STEP/STP tem tempo limite e se recupera de travamentos do importador, em vez de congelar o app.
- **HALOT-MAGE:** perfis salvos que ainda exportavam CTB passam automaticamente para CXDLPv4, o formato que a impressora lê.
- **Avisos de licença:** as builds levam a licença AGPL e os avisos de terceiros, e os plugins derivados do DragonFruit dizem que são forks.

**Correções**

- **Menu de reparo:** Remesh e Shrink-Wrap voltaram para o submenu Reparar do editor.
- **Relatórios de importação da release:** cada plataforma publica o seu relatório com nome próprio, sem um sobrescrever o outro.
- **Marca:** o app deixou de apresentar a marca DragonFruit como se fosse do Rambutan Slicer.

**Por dentro**

- O `page.tsx` do editor, o gerenciador de cena e o `SceneCanvas` foram divididos em hooks e módulos menores, e o `main.rs` do Tauri em módulos (backup, autosave, ilhas, arquivos, integrações, logs, diálogos). O comportamento não muda.
- O CI roda os testes do motor de fatiamento em Rust e do crate `src-tauri`, e o workflow de testes ficou verde.

## [0.6.0] - 2026-11-24

### Windows

**Correções**

- **Runtime da Microsoft:** a versão fixada do Visual C++ passa a ser a 14.52.37029.0, e a verificação do pacote do Windows lê o nome do executável do `Cargo.toml`.

### Linux

**Novidades**

- **Flatpak** com nome e ID próprios do Rambutan Slicer.

### macOS

**Correções**

- **Assinatura:** o time da Apple e a identidade de assinatura vêm dos secrets do repositório. Sem eles, o build do macOS sai com assinatura ad-hoc.

### Todas as plataformas

**Novidades**

- **Importação STEP/STP:** arquivos CAD são convertidos em malha por um importador OCCT em WebAssembly.
- **Diagnóstico de importação:** falhas de importação ficam registradas com a etapa em que aconteceram e podem ser salvas em um relatório.
- **Edição do CTB depois de fatiar:** os pixels de uma camada podem ser editados na prévia de impressão e gravados de volta no CTB, e ilhas sem suporte podem ser procuradas ou removidas em todas as camadas.
- **Revisão final antes de exportar:** ilhas, regiões flutuantes, colisões e furos de drenagem são verificados antes de imprimir.
- **Gravação:** relevo em alto-relevo, relevo a partir de imagem e reposicionamento na superfície do modelo.
- **Visual:** oclusão ambiente mais forte por padrão, cor base na prévia de impressão e logo colorido do Rambutan na mesa.
- Guia de preparação, escolha de superfície para gravação e volume do sólido, com ajustes nos suportes automáticos, travamentos, colisões e esvaziamento.

**Correções**

- **Perfis de impressora:** tamanhos de tela corrigidos com base nos presets do ChiTuBox (Photon M3 Premium, LD-002R, LD-002H, Halot One Pro, Halot Ray, Halot Mage / Mage Pro, Photon Mono M7 / M7 Pro / M7 Max, Mars 5, LD-006). Antes, algumas peças saíam maiores que o modelo.
- **HALOT-MAGE:** passa a exportar CXDLPv4 em vez de CTB, que a impressora não reconhecia. HALOT-MAGE PRO e MAGE S 14K agora fatiam.
- **Regras CTB de vários parâmetros** passam a valer para a exposição das camadas normais.
- **Escala de cinza e preenchimento por modelo** ficam dentro do próprio modelo em todos os modos de anti-aliasing.
- **Links externos** são validados antes de abrir no navegador.
- **Clone recursivo:** o submódulo do plugin UniFormation usa URL absoluta e volta a baixar.
