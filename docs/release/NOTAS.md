## Como usar esta versão

### Instalação

- **Windows x64** — execute o instalador `setup.exe`. Se recebeu a pasta portátil, mantenha o executável e as DLLs juntos e abra `rambutan-slicer.exe`.
- **macOS (não testado)** — abra o DMG e arraste Rambutan Slicer para Aplicativos. Esta versão só foi compilada; ninguém a testou em um Mac. Sem certificado da Apple no CI, o DMG sai sem assinatura nem notarização.
- **Linux** — instale o arquivo Flatpak e abra Rambutan Slicer pelo menu de aplicativos.

No primeiro acesso, selecione o perfil da sua impressora. Use **Importar modelo** para malhas e **Abrir cena** para projetos. A lista depende dos importadores disponíveis na instalação.

### Revisão antes de imprimir

Em **Exportar**, abra **Revisão para impressão** e selecione o modelo que quer revisar. Execute as verificações de ilhas, regiões flutuantes, colisões e furos de drenagem. Clique em um achado para centralizar a câmera na sua posição. Repita a revisão após modificar o modelo ou os suportes.

Para registrar uma falha de importação, abra o menu do Rambutan Slicer → **Diagnóstico de importação** → **Salvar relatório**. O JSON inclui a versão, a etapa, o nome e tamanho do arquivo e os detalhes técnicos. Ele reúne os erros da sessão atual.

### Verificação da build

O empacotamento exercita os importadores pela interface de produção e exige que cada formato anunciado carregue geometria. O relatório `VERIFICACAO-*.md` registra as extensões testadas e os resultados. Um STEP inválido também exercita a geração do relatório de erro.
