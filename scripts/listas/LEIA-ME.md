# Verificar o que realmente funciona nas listas

Script: `scripts/listas/verificar-listas.mjs` (Node 18+, sem dependências, **só leitura**).
Ele testa item por item e gera, para cada tipo, uma lista só com o que funciona.

| Comando | O que testa | Quanto dura (lista do Gustavo) |
|---|---|---|
| `canais` | cada canal ao vivo: manifesto HLS, trechos, velocidade, codecs reais (H.264/HEVC/AAC/AC-3...) | ~1.600 canais ≈ 1 a 2 h |
| `filmes` | cada filme: responde? é vídeo de verdade (não HTML)? tamanho, formato, aceita avançar/voltar (Range)? | 30.203 filmes ≈ 4 a 5 h |
| `series` | cada série (episódios agrupados por `S01E02`): testa o 1º episódio (ou todos com `--episodios todos`) | 8.426 séries ≈ 1 a 2 h (todos os episódios: 286 mil, dias) |

## Como rodar
Os links (com usuário e senha) **não ficam no código**: vão em variáveis de ambiente.

PowerShell:
```powershell
$env:LISTA_CANAIS = "<link da lista de canais>"
$env:LISTA_VOD    = "<link da lista de filmes e séries>"
node scripts/listas/verificar-listas.mjs canais
node scripts/listas/verificar-listas.mjs filmes
node scripts/listas/verificar-listas.mjs series
```

Opções úteis: `--amostra 200` (testa só 200 itens espalhados pela lista, para ter uma ideia em minutos), `--concorrencia 2` (padrão; máximo 8),
`--pausa 200` (ms entre pedidos), `--filtro esporte` (só itens cujo nome/grupo contenha o texto), `--retomar` (continua de onde parou, na mesma `--saida`),
`--saida pasta`, `--episodios todos`, `--profundo` (canais: baixa o trecho inteiro para medir a velocidade com mais precisão).

**Cuidado com o provedor:** o padrão é gentil (2 em paralelo). Se vierem 20 respostas 401/403/429 seguidas, o script **para sozinho** (possível bloqueio da conta).
Rode primeiro com `--amostra 200` de cada tipo e só depois a lista inteira. Pode parar a qualquer momento (Ctrl+C) e continuar com `--retomar --saida <a mesma pasta>`.

## O que sai (pasta `resultado-listas/<tipo>-<data>/`)
- `resumo.md` / `resumo.json`: totais e quantos de cada veredito
- `falhas.csv`: o que **não** funciona e por quê (abre no Excel)
- `ok.m3u`: lista **só com o que funciona**
- `ok-ressalvas.m3u`: funciona com ressalva (canais "frios" que abrem devagar; filmes `.mkv`, que tocam no Chrome/Edge mas costumam falhar no iPhone/Safari; séries parciais)
- `resultados.jsonl`: tudo, uma linha por item (para filtrar com outro programa)

Os relatórios **não** têm usuário nem senha. Os arquivos `.m3u` têm as URLs reais: trate como segredo (não publique).

## Vereditos
Canais: `OK`, `TS_DIRETO` (fluxo contínuo, o app toca por mpegts.js), `SO_AUDIO` (rádio), `FRIO` (manifesto lento ou janela de 1 trecho), `LENTO` (baixa a menos de 1,5x o tempo real),
`CODEC_INCOMPATIVEL` (HEVC, AC-3, AAC-LATM, MPEG-2), `SEM_VIDEO`, `SEM_TRECHOS`, `FORA_DO_AR` (HTTP 4xx/5xx, página HTML do provedor, tempo esgotado), `FORMATO_INESPERADO`.
Filmes/episódios: `OK`, `OK_MKV`, `SEM_RANGE`, `FORMATO_NAO_TOCA` (avi/wmv/flv...), `ARQUIVO_PEQUENO`, `NAO_E_VIDEO`, `NAO_EXISTE` (404), `BLOQUEADO` (401/403/429), `FORA_DO_AR`.
Séries: `OK`, `OK_MKV`, `PARCIAL` (parte dos episódios testados falhou), ou o veredito do episódio testado.

## Prompt pronto para a outra IA (Antigravity)
> Você está no repositório do Sintoniza. Rode o script `scripts/listas/verificar-listas.mjs` (leia o cabeçalho e o `scripts/listas/LEIA-ME.md` antes). **Não altere o script nem nenhum outro arquivo e não faça nenhum pedido que não seja de leitura.**
> Os links das listas estão nas variáveis de ambiente `LISTA_CANAIS` e `LISTA_VOD` que eu vou definir; **nunca escreva usuário nem senha em arquivos, mensagens ou commits**.
> 1. Rode cada comando (`canais`, `filmes`, `series`) primeiro com `--amostra 200` e me mostre o `resumo.md` de cada um.
> 2. Se eu aprovar, rode a lista inteira de cada tipo, um tipo por vez, sem aumentar a concorrência acima de 2. Se o script parar por bloqueio, pare, espere e retome com `--retomar` e `--concorrencia 1`.
> 3. Ao final, me entregue: o caminho das pastas de resultado, o `resumo.md` de cada tipo, as 10 causas de falha mais comuns (de `falhas.csv`) e os arquivos `ok.m3u` e `ok-ressalvas.m3u`.
