# Sintoniza TV — Melhorias pendentes (25/09/2026)

> Documento de acompanhamento, não um plano de execução formal. Resume o que foi corrigido hoje nos dois apps de TV (o vanilla, em produção, e o React/Preact em teste), e o que falta para cada um.

---

## 1. App vanilla (`sintoniza-tv/`) — em produção, v1.9.5

Testado ao vivo na sua LG (modelo 43LM631C0SB, firmware 05.40.97) e hoje ficou utilizável pela primeira vez. Bugs encontrados e corrigidos, nessa ordem:

1. **Sintaxe incompatível quebrava o app inteiro** — um `{...objeto}` (recurso de 2018) em `xtreamApiUrl` fazia o Chromium desta TV recusar o bloco de script inteiro, silenciosamente. Trocado por `Object.assign`. Também corrigido `catch {}` sem parâmetro.
2. **Botão Voltar do controle da LG não fazia nada** — ele manda um código (`461`) que o app não reconhecia (só reconhecia o da Samsung). Corrigido.
3. **Voltar saía do app direto pro menu da TV** — comportamento padrão do sistema (liga o botão ao histórico do navegador, que o app nunca usa). Desligado via `disableBackHistoryAPI`.
4. **Layout encolhido no canto da tela** — o CSS tinha `1920x1080` fixo, mas essa TV relata uma tela de `1280x720`. Trocado para `vw`/`vh`, que se adapta a qualquer resolução real.
5. **Menu não respondia ao D-pad, só ao ponteiro** — o foco de verdade entrava no menu, mas o contorno branco que mostra onde está o foco ficava preso no lugar antigo. Corrigido em 4 pontos do código.
6. **Colar parou de funcionar nos campos de URL** — tinham virado "somente leitura" para forçar o teclado on-screen, o que bloqueou colar pelo ponteiro do controle e pelo app LG ThinQ. Os campos voltaram a ser editáveis; o teclado on-screen agora abre por um botão "⌨" ao lado, só para quem usa exclusivamente o D-pad.

### Pendências reais deste app
- [ ] **Ícone do launcher** ainda pequeno/mal proporcionado comparado a Paramount+/Netflix (ver `docs/superpowers/plans/2026-09-24-tv-app-reconstrucao.md`, seção 3.8) — arrastado desde a rodada anterior, nunca foi feito.
- [ ] **Teste com sua lista de verdade** — tudo até aqui foi validado só com os canais de demonstração. Falta confirmar que carregar a lista M3U real, o EPG e o catálogo de Filmes/Séries funcionam de ponta a ponta.
- [ ] **Samsung Tizen** — todas as correções de hoje foram confirmadas só na LG. O `config.xml` existe mas nunca foi testado num aparelho Samsung de verdade.

---

## 2. App React/Preact (`sintoniza-tv-app/`) — ainda em teste, não é o app de produção

Este é o app novo, construído do zero seguindo `docs/superpowers/plans/2026-09-25-tv-app-migracao-react.md`, para resolver de vez a causa de fundo dos bugs acima (verificação automática de compatibilidade, em vez de depender de alguém lembrar na hora de escrever o código). Instalado lado a lado com o app vanilla, sob um nome diferente (`com.sintoniza.iptv.react`), sem afetar o app de produção.

Hoje ele saiu de "tela preta, nada funciona" para **realmente abrir**: barra lateral (Início, Filmes e Séries, Favoritos, Configurações) e a seção "Canais ao vivo" com o aviso de lista vazia — confirmado com print direto da tela real da TV. Foram 4 camadas de bug diferentes, uma escondendo a outra:

1. Uma sessão anterior tinha trocado a base de Preact para React de verdade pela metade (mudou a configuração, mas não os arquivos) — quebrando os testes. **Revertido para Preact**, como você pediu.
2. Depois de revertido, uma biblioteca de terceiros (a de navegação por controle) carregava uma cópia de React vazia por baixo dos panos. Corrigido com uma configuração extra de "alias" nos testes.
3. O app, uma vez instalado como `.ipk`, gera os links dos arquivos (CSS, JavaScript) como se fosse rodar num site normal (`/assets/...`), mas isso aponta pra raiz do sistema de arquivos da TV, não pra pasta do app — nada carregava. Corrigido.
4. Mesmo com os links certos, essa TV se recusa, em silêncio, a rodar o formato mais novo de arquivo JavaScript (`type="module"`) quando o app roda direto de arquivo (sem servidor) — é uma restrição de segurança documentada da própria ferramenta que usamos para compilar. Trocado para o formato clássico, compatível com qualquer navegador.
5. Faltava uma linha de inicialização da biblioteca de navegação por controle no arquivo principal do app — só os testes tinham essa linha, o app de verdade não. Sem ela, qualquer tentativa de usar o controle quebrava.

### O que falta para este app poder ser considerado uma alternativa real
- [ ] **Visual ainda é o rascunho mínimo** (fundo escuro simples, texto sem estilo nenhum) — falta portar o tema escuro/dourado e o desenho das fileiras estilo Netflix que o app vanilla já tem.
- [ ] **Testar o controle remoto de verdade nele** — hoje só confirmei que a tela carrega; ainda não testei se as setas, o Voltar e o teclado on-screen funcionam de verdade com o D-pad físico (o app vanilla passou por 3 rodadas de bugs desse tipo — é bem provável que apareça algo parecido aqui também).
- [ ] **Carregar uma lista de verdade** — só foi testado com a tela vazia.
- [ ] **Reduzir o tamanho do arquivo final** (hoje ~940KB, o Vite avisou que está grande) — não afeta funcionamento, só o tempo de abrir o app.
- [ ] **appinfo.json/config.xml deste app** foram criados hoje, na pressa, copiando o ícone antigo — revisar antes de qualquer lançamento de verdade.

### Decisão que ainda não foi tomada
Este app React continua sendo **teste**, instalado ao lado do vanilla, sem substituir nada. Antes de decidir se ele vira o app de produção, falta pelo menos: aplicar o visual de verdade, testar o controle físico, e testar com sua lista real — os mesmos três pontos que já causaram problema no app vanilla e ainda não foram confirmados aqui.
