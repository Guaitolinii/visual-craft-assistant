// Proxy HTTPS -> HTTP para streams de IPTV.
//
// Por que existe: navegadores bloqueiam qualquer pedido de uma página HTTPS
// para um endereço HTTP puro ("conteúdo misto" / mixed content). Como o
// sintoniza-link.html roda em HTTPS (GitHub Pages) e muitos provedores de
// IPTV só oferecem HTTP, o navegador recusa a conexão direta. Este worker
// roda sempre em HTTPS, busca o stream HTTP por trás e devolve o conteúdo
// para o navegador já em HTTPS — o navegador nunca fala diretamente com o
// endereço HTTP original.
//
// Uso: GET /stream?url=<url-do-stream-codificada>
// - Repassa .ts (MPEG-TS) em streaming direto (sem carregar tudo em memória).
// - Reescreve playlists .m3u8 (HLS) para que os segmentos referenciados
//   também passem pelo proxy, senão eles falhariam pelo mesmo motivo.

const UPSTREAM_HEADERS = {
  // Muitos provedores de IPTV (padrão Xtream Codes) restringem o acesso por
  // User-Agent, aceitando players conhecidos como o VLC.
  "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
  "Accept": "*/*",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  };
}

function isPlaylist(targetUrl, contentType) {
  return targetUrl.pathname.toLowerCase().endsWith(".m3u8")
    || contentType.toLowerCase().includes("mpegurl");
}

async function rewritePlaylist(body, targetUrl, proxyOrigin) {
  const base = targetUrl.href.slice(0, targetUrl.href.lastIndexOf("/") + 1);
  const lines = body.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const absolute = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : new URL(trimmed, base).href;
    return `${proxyOrigin}/stream?url=${encodeURIComponent(absolute)}`;
  });
  return lines.join("\n");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname !== "/stream") {
      return new Response(
        "Proxy de streams do Sintoniza. Uso: /stream?url=<url-codificada>",
        { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }

    const target = url.searchParams.get("url");
    if (!target) {
      return new Response("Parâmetro url ausente", { status: 400, headers: corsHeaders() });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response("URL inválida", { status: 400, headers: corsHeaders() });
    }
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return new Response("Protocolo não suportado", { status: 400, headers: corsHeaders() });
    }

    const upstreamHeaders = new Headers(UPSTREAM_HEADERS);
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);

    let upstreamResp;
    try {
      upstreamResp = await fetch(targetUrl.toString(), {
        headers: upstreamHeaders,
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (e) {
      return new Response("Falha ao buscar a origem: " + e.message, { status: 502, headers: corsHeaders() });
    }

    const contentType = upstreamResp.headers.get("Content-Type") || "";

    if (isPlaylist(targetUrl, contentType)) {
      const body = await upstreamResp.text();
      const rewritten = await rewritePlaylist(body, targetUrl, url.origin);
      return new Response(rewritten, {
        status: upstreamResp.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Repasse em streaming (segmentos .ts, transporte MPEG-TS ao vivo, etc.)
    // - upstreamResp.body é passado direto, sem bufferizar tudo em memória.
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", contentType || "video/mp2t");
    const contentLength = upstreamResp.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstreamResp.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);
    headers.set("Cache-Control", "no-cache, no-store");
    headers.set("Accept-Ranges", "bytes");

    return new Response(upstreamResp.body, { status: upstreamResp.status, headers });
  },
};
