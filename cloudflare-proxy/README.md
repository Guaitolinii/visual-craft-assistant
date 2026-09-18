# Proxy de stream do Sintoniza (Cloudflare Worker)

Resolve o bloqueio de "conteúdo misto" do navegador: o `sintoniza-link.html`
publicado no GitHub Pages roda em HTTPS, mas muitos canais IPTV só têm
endereço HTTP puro. Navegadores proíbem uma página HTTPS de buscar conteúdo
HTTP - não tem jeito de contornar isso só com JavaScript. Este Worker roda
sempre em HTTPS, busca o stream HTTP por trás e devolve pro navegador já em
HTTPS.

## Deploy (uma vez só)

Pré-requisito: conta gratuita em [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).

```bash
cd cloudflare-proxy
npx wrangler login   # abre o navegador para autorizar
npx wrangler deploy
```

Ao final, o terminal mostra o endereço publicado, algo como:

```
https://sintoniza-stream-proxy.<seu-usuario>.workers.dev
```

## Conectar no player

1. Abra `sintoniza-link.html`, vá em **Configurações**.
2. No campo **"Proxy de stream (opcional)"**, cole esse endereço.
3. Clique em **"Salvar proxy"**.

A partir daí, qualquer canal com URL `http://` passa a ser buscado através
do proxy automaticamente. Canais `https://` continuam indo direto, sem
passar pelo proxy (não precisam).

## Testar localmente antes de publicar

```bash
cd cloudflare-proxy
npx wrangler dev --local --port 8787
```

```bash
curl "http://127.0.0.1:8787/stream?url=http%3A%2F%2Fexemplo.com%2Fcanal.ts"
```

## Limites do plano gratuito

100.000 requisições/dia - cada segmento de vídeo (.ts) ou pedaço de playlist
conta como uma requisição. Para uso pessoal (poucos dispositivos assistindo
ao mesmo tempo) isso é mais do que suficiente.
