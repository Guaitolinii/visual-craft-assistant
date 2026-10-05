# Travamento dos canais ao vivo — plano

> **Escopo:** só canais ao vivo (HLS e MPEG-TS) no app web e no celular. Filmes e séries ficam de fora. A TV (app React) só entra na fase final, se o resultado valer para ela.
> **Para quem executa:** use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Os passos usam `- [ ]`.

**Objetivo:** reduzir o tempo até aparecer imagem, as paradas no meio da reprodução e os canais que ficam em tela preta/spinner sem explicação.

**Como o trabalho está organizado:** primeiro medir (fase 0), depois atacar os problemas na ordem em que mais pesam na medição (fases 1 a 4). Nada de ajustar parâmetro "no escuro".

---

## O que já sabemos (medição de 05/10/2026, app web v19 em produção, conta de teste, 12 canais da lista real, 22 s cada)

| Resultado | Canais | O que aconteceu |
|---|---|---|
| Tocou, parada só na abertura | 7 de 12 | 1º quadro em 2,0–5,6 s; uma única espera de 0,5–2,9 s e depois fluido (0 quadros perdidos) |
| Nunca tocou: `fragParsingError` | 2 de 12 | trecho baixa, mas o hls.js não consegue ler (áudio/vídeo fora do que ele remuxa) — 4 tentativas e para |
| Nunca tocou: `aborted` ×4 | 1 de 12 | **suspeito de bug do app**: as requisições são abortadas e nada toca (mesmo sintoma do TV Clube/Angel TV da conversa anterior) |
| Nunca tocou: `manifestLoadError` fatal | 1 de 12 | lista/canal fora do ar no provedor |
| Parou no meio | 1 de 12 | CNN Portugal: `fragLoadError` ×3 + `bufferStalledError`, 6,7 s parado em 22 s (provedor instável) |

**Conclusão que muda o plano:** a página em si **não** é o problema — 0 tarefas longas e 0 quadros perdidos em todos os canais. O travamento vem de (1) arranque lento, (2) canais que o player desiste de tocar ou nem tenta direito, (3) instabilidade do provedor tratada de forma pouco esperta. Por isso o plano foca no player e na rede, não em desenho de tela.

Já temos: o código de reprodução está em `sintoniza-link.html` (hls.js em `new Hls({...})` por volta da linha 5940; mpegts.js por volta da 6059; watchdog N1/N2/N3, degraus de buffer 15→60 s, `computeReconnectBackoffMs`, `webRestartViaProxy`). E o v18 já tem trabalho pela metade em `…/scratchpad/app-v18-wt` (mensagens de erro classificadas, "Copiar diagnóstico", testes `tests/player/playback-failure*.test.js`, `live-diagnostic.test.js`) — **não foi commitado**.

---

## Metas (medidas com o mesmo benchmark, mesma amostra)

| Métrica | Hoje | Meta |
|---|---|---|
| Tempo até o 1º quadro (mediana dos canais que tocam) | ~3,9 s | ≤ 2,5 s |
| Pior caso do 1º quadro | 5,6 s | ≤ 4 s |
| Parada no meio da reprodução (tempo parado / 22 s, canais saudáveis) | 0,5–2,9 s (todos no arranque) | ≤ 1 s |
| Canais com tela preta/spinner sem mensagem | 3 de 12 | 0 (ou toca, ou diz o motivo em ≤ 15 s) |
| `aborted` sem causa | 1 de 12 | 0 |

---

## Fase 0 — Linha de base e ferramenta de medição

**Arquivos:** `scripts/dev/bench-canais.mjs` (já criado e commitado), este plano.

- [ ] **0.1** Rodar o benchmark com uma amostra maior e fixa (30 canais, passo 37) e guardar a saída em `docs/superpowers/plans/dados/2026-10-05-bench-canais-base.txt`:
  `node scripts/dev/bench-canais.mjs C:/Users/guait/Documents/Novo-App-de-TV/.env.ott.local 30 37`
  (cada rodada registra 1 aparelho web na conta de teste e o remove no fim; limite de 5 aparelhos web — não rodar duas vezes em paralelo).
- [ ] **0.2** Rodar a mesma amostra **com o proxy forçado** e **com o direto forçado** (campo `sint_web_hosts` no `localStorage`, valor `p` ou `d` para o host) para separar "problema do provedor" de "problema do proxy". Anotar a diferença no mesmo arquivo.
- [ ] **0.3** Classificar cada falha em: provedor fora (404/403/5xx/manifestLoadError), codec (`fragParsingError`/`bufferAddCodecError`), bloqueio do navegador (`aborted`/CORS), instabilidade (`fragLoadError`/`bufferStalledError`). Isso decide a ordem das fases 2–4.

**Critério de saída:** tabela com 30 canais e a causa de cada falha.

---

## Fase 1 — Parar de desistir/atrasar à toa (app, baixo risco)

**Arquivos:** `sintoniza-link.html` (funções de reprodução HLS/MPEG-TS, watchdog), `tests/player/*`.

- [ ] **1.1 Fechar o v18 pela metade.** Abrir o worktree `app-v18-wt`, conferir `git diff`, rodar `npm test` + `scripts/dev/check-*.mjs`, commitar e trazer para a v19/v20 (merge ou cherry-pick). Entrega: mensagem de erro por classe ("fora do ar", "não decodifica", "não respondeu", "navegador bloqueou"), botões "Tentar de novo / Escolher outro canal", "Copiar diagnóstico" (sem URL nem token) e Ctrl+Shift+D. **Isso zera "tela preta sem explicação".**
- [ ] **1.2 Investigar o `aborted`** (Lagoa de Santo André, TV Clube, Angel TV): reproduzir com `scripts/dev/bench-canais.mjs` apontando só para esses canais, registrar quem aborta (timeout de 15 s do `initialLoadTimeout` + `reloadCurrentChannel`? `webRestartViaProxy`? troca de geração `playbackGeneration`?). Escrever um teste que reproduza a sequência e corrigir a causa. Hipótese a confirmar, não assumir.
- [ ] **1.3 Não reiniciar o canal por `bufferStalled` não fatal.** O hls.js já recupera sozinho; hoje o watchdog pode empurrar `currentTime` (N1 +0,15 s) e reconstruir (N2/N3) cedo demais. Medir antes/depois no CNN Portugal.
- [ ] **1.4 O timeout de 15 s do arranque não deve piorar o próximo arranque.** Hoje ele chama `escalateBufferStage()` + recarrega: o canal lento passa a exigir mais buffer (mais espera ainda). Trocar por: 1ª vez só tenta de novo; só sobe o degrau de buffer se a **reprodução** (não o arranque) parar.

**Critério de saída:** o benchmark da amostra não tem mais `aborted`; toda falha mostra mensagem com a classe certa em ≤ 15 s; paradas no meio caem para ≤ 1 s nos canais saudáveis.

---

## Fase 2 — Arranque mais rápido (meta ≤ 2,5 s)

**Arquivos:** `sintoniza-link.html` (`detectStreamType`, `webHlsPlan`, config do `new Hls`).

Medir cada etapa do arranque no benchmark (sondagem de tipo → manifesto → 1º segmento → 1º quadro) antes de mexer; só otimizar a etapa que mais pesa.

- [ ] **2.1 Pular/guardar a sondagem do tipo.** `detectStreamType(url)` faz uma requisição antes do hls.js. Guardar o tipo por URL/host em memória (como `sint_web_hosts`) e, para `.m3u8` na URL, ir direto ao hls.js.
- [ ] **2.2 Começar por uma qualidade menor e subir.** `startLevel` baixo + ABR depois (canais com várias qualidades hoje começam pela escolha do hls.js, que pode puxar um nível pesado). Testar `startLevel: 0` e `capLevelToPlayerSize: true` (no desktop o player não precisa de 1080p em 292 px de altura).
- [ ] **2.3 Buffer de arranque menor.** O primeiro degrau (`stage.hlsMax` 15 s) não deveria atrasar o início; conferir que o hls.js começa a tocar com ~2 segmentos (`liveSyncDurationCount: 3` → testar 2 só no arranque) e que `startFragPrefetch: true` está ligado.
- [ ] **2.4 Ligação prévia ao provedor.** `<link rel="preconnect">` dinâmico para o host do canal ao passar o mouse/focar no cartão (web) — corta o handshake do arranque. Só no web; no celular nativo não vale.

**Critério de saída:** mediana do 1º quadro ≤ 2,5 s e pior caso ≤ 4 s na amostra de 30 canais, sem aumentar as paradas.

---

## Fase 3 — Provedor instável (paradas no meio)

**Arquivos:** `sintoniza-link.html` (retentativas, backoff, níveis).

- [ ] **3.1 Reação em degraus no hls.js:** em `fragLoadError`/`bufferStalledError` repetidos, **descer um nível de qualidade** (`hls.nextLoadLevel`/`autoLevelCapping`) antes de subir o buffer; voltar a subir depois de 60 s estável.
- [ ] **3.2 Retentativas com cabeça fria:** `fragLoadingMaxRetry`/`fragLoadingRetryDelay` por rota (direto 3, proxy 8 hoje) revisar com os dados da fase 0; backoff exponencial com teto (já existe `computeReconnectBackoffMs`) e **mensagem "Tentando de novo (n/3)"**.
- [ ] **3.3 Troca de rota quando o direto degrada:** se o direto tem 2+ `fragLoadError` seguidos e antes funcionava, tentar o proxy uma vez e lembrar no `sint_web_hosts` (hoje só cai no proxy se falhar **antes** de tocar).
- [ ] **3.4 MPEG-TS (mpegts.js):** conferir `liveBufferLatencyChasing` e `lazyLoad` — o `mpegtsSoftRestartOrReload` já existe, medir se dispara à toa.

**Critério de saída:** no CNN Portugal e em outros 2 canais instáveis da amostra, o tempo parado cai pela metade ou mais.

---

## Fase 4 — Canais que "nunca tocam" por codec (`fragParsingError`)

**Arquivos:** `sintoniza-link.html`, possivelmente nada no backend.

- [ ] **4.1 Descobrir o codec real** dos 2 canais (`Filmes Suspense`, `O Encantador de Cães`): baixar 1 segmento `.ts` e inspecionar (PMT: AAC-LATM? AC-3? E-AC-3? HEVC?). Já há `diag-bytes2.mjs` no scratchpad do caso ESPN/South Park (AAC LATM) para reaproveitar.
- [ ] **4.2 Decidir por causa:**
  - AAC-LATM/AC-3: o hls.js não resolve; avaliar se o `mpegts.js` consegue tocar o mesmo canal (ele remuxa LATM) quando o servidor também entrega o fluxo TS contínuo (`.ts`/`live/user/pass/id.ts` do Xtream em vez de `.m3u8`). **Se a lista Xtream oferece as duas formas, trocar de `.m3u8` para `.ts` só nesses canais.**
  - HEVC: depende do navegador (Chrome com GPU aceita; senão não). Só mensagem clara.
  - Sem solução no cliente: mensagem "este canal usa um formato que o navegador não reproduz" (já prevista no v18).
- [ ] **4.3 Memória por canal:** lembrar o formato que funcionou (`sint_fmt_<hash>` = `hls`|`ts`) para não repetir a tentativa que falha.

**Critério de saída:** dos 2 canais com `fragParsingError`, ou tocam via `.ts`, ou mostram a mensagem correta em ≤ 15 s.

---

## Fase 5 — Fechamento

- [ ] **5.1** Rodar o benchmark final (mesma amostra de 30) e preencher a tabela de metas; guardar em `docs/superpowers/plans/dados/2026-10-05-bench-canais-final.txt`.
- [ ] **5.2** `npm test` + todos os `scripts/dev/check-*.mjs` verdes; novo teste de regressão para cada correção (`tests/player/`).
- [ ] **5.3** Versão (v20 ou a próxima livre; mesma regra do bump da v19: iOS MARKETING_VERSION/CURRENT_PROJECT_VERSION, Android versionName/versionCode, `APP_VERSION`, workflow `build-mobile-vN.yml`), push e `npm run deploy:site`.
- [ ] **5.4** Só depois, avaliar levar o que serve ao app da TV (Chrome 53: sem `AbortController`, sem `gap` em flex) — a TV tem outro player; fica fora desta entrega.

---

## Riscos e cuidados

- **Canais mortos no provedor não têm conserto no app** — o ganho é a mensagem e o tempo certos, não fazer tocar.
- **Mexer em buffer/qualidade afeta TODOS os canais:** cada mudança sai com antes/depois do benchmark na amostra inteira; reverter se a mediana piorar.
- **Limite de 5 aparelhos web na conta de teste** e limite de `device_start` (20/h): uma rodada do benchmark por vez.
- **Cota do Cloudflare (100 mil requisições/dia):** o benchmark pelo proxy consome; a amostra de 30 canais × 22 s é pequena, mas não rodar em laço.
- Sem tela de depuração nem URLs/tokens em mensagens ou no "Copiar diagnóstico".

## Ordem sugerida e esforço

1. Fase 0 (30 min) → 2. Fase 1 (maior ganho percebido, ~1 dia) → 3. Fase 2 (~meio dia) → 4. Fase 3 (~meio dia) → 5. Fase 4 (depende da fase 0.3) → 6. Fase 5.
