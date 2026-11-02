import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseM3u,
  lerChaveEnv,
  familiaDoCanal,
  filtrarCanais,
  sondar,
  classificar,
  executarRodada,
  lerSondagens,
  resumir,
  tabelaTexto,
} from "../../scripts/monitor-canais/lib.mjs";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("scripts/monitor-canais/cli.mjs");

function runCli(args) {
  return execFileAsync(process.execPath, ["--", cliPath, ...args]);
}
// --- Testes de funções puras ---

test("parseM3u: processa lista M3U com CRLF, vírgulas no nome e ignora entradas inválidas", () => {
  const m3u = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="1" group-title="ESPORTES", ESPN 2, FHD',
    "http://stream.local/espn2.ts",
    '#EXTINF:-1 group-title="ESPORTES", Sportv HD',
    "https://stream.local/sportv.m3u8",
    '#EXTINF:-1 group-title="FILMES", Canal Sem Url',
    "# Comentário ou linha sem URL",
    '#EXTINF:-1 group-title="INVALIDO", Canal RTMP',
    "rtmp://stream.local/live",
    '#EXTINF:-1, Canal Sem Grupo',
    "http://stream.local/nogroup.ts",
  ].join("\r\n");

  const canais = parseM3u(m3u);
  assert.equal(canais.length, 3);
  assert.deepEqual(canais[0], {
    nome: "FHD", // última vírgula: " ESPN 2, FHD" -> "FHD"
    grupo: "ESPORTES",
    url: "http://stream.local/espn2.ts",
  });
  assert.deepEqual(canais[1], {
    nome: "Sportv HD",
    grupo: "ESPORTES",
    url: "https://stream.local/sportv.m3u8",
  });
  assert.deepEqual(canais[2], {
    nome: "Canal Sem Grupo",
    grupo: "",
    url: "http://stream.local/nogroup.ts",
  });
});

test("lerChaveEnv: lê chaves .env com aspas, espaços e comentários", () => {
  const envContent = `
# Comentário
OTT_CONTA_CANAIS="http://meu-servidor.com/lista.m3u"
OUTRA_CHAVE='valor-simples'
CHAVE_VAZIA=""
  `.replace(/\n/g, "\r\n");

  const url = lerChaveEnv(envContent, "OTT_CONTA_CANAIS");
  assert.equal(url, "http://meu-servidor.com/lista.m3u");

  const simples = lerChaveEnv(envContent, "OUTRA_CHAVE");
  assert.equal(simples, "valor-simples");

  assert.throws(
    () => lerChaveEnv(envContent, "CHAVE_INEXISTENTE"),
    /chave CHAVE_INEXISTENTE ausente no arquivo de ambiente/
  );

  assert.throws(
    () => lerChaveEnv(envContent, "CHAVE_VAZIA"),
    /chave CHAVE_VAZIA ausente no arquivo de ambiente/
  );
});

test("familiaDoCanal: normaliza nomes e remove termos de resolução", () => {
  assert.equal(familiaDoCanal("ESPN 2 FHD"), "espn 2");
  assert.equal(familiaDoCanal("Premiere 2 4K"), "premiere 2");
  assert.equal(familiaDoCanal("Sportv 2 4K"), "sportv 2");
  assert.equal(familiaDoCanal("SporTV 2 HD"), "sportv 2");
  assert.equal(familiaDoCanal("XSPORTS FHD ²"), "xsports ²");
  assert.equal(familiaDoCanal("Canal SD Extra"), "canal extra");
});

test("filtrarCanais: filtra por grupos e remove excluídos", () => {
  const canais = [
    { nome: "ESPN FHD", grupo: "Esportes BR", url: "http://a.com/1" },
    { nome: "ESPN Rádio HD", grupo: "Esportes BR", url: "http://a.com/2" },
    { nome: "HBO Plus", grupo: "Filmes", url: "http://a.com/3" },
    { nome: "Sportv 4K", grupo: "ESPORTES INTERNACIONAL", url: "http://a.com/4" },
  ];

  const filtrados = filtrarCanais(canais, {
    grupos: ["esportes"],
    excluir: ["rádio", "radio"],
  });

  assert.equal(filtrados.length, 2);
  assert.equal(filtrados[0].nome, "ESPN FHD");
  assert.equal(filtrados[1].nome, "Sportv 4K");

  // Sem grupos informados -> lista vazia
  assert.deepEqual(filtrarCanais(canais, { grupos: [] }), []);
  assert.deepEqual(filtrarCanais(canais, {}), []);
});

test("classificar: classifica corretamente com base na tabela da especificação", () => {
  // 429 -> limitado
  assert.equal(classificar({ http: 429 }), "limitado");

  // Erro sem bytes, http >= 400, bytes === 0, tipo html/vazio/outro -> morto
  assert.equal(classificar({ http: 200, bytes: 0, tipo: "vazio", erro: null }), "morto");
  assert.equal(classificar({ http: 500, bytes: 100, tipo: "ts", erro: null }), "morto");
  assert.equal(classificar({ http: 0, bytes: 0, tipo: "vazio", erro: "timeout" }), "morto");
  assert.equal(classificar({ http: 200, bytes: 500, tipo: "html", erro: null }), "morto");
  assert.equal(classificar({ http: 200, bytes: 500, tipo: "outro", erro: null }), "morto");

  // HLS 200 -> vivo
  assert.equal(classificar({ http: 200, bytes: 1000, tipo: "hls", erro: null }), "vivo");

  // TS: kbps >= 500 e maiorLacunaMs < 3000 -> vivo; senão instavel
  assert.equal(
    classificar({ http: 200, bytes: 50000, kbps: 600, maiorLacunaMs: 1500, tipo: "ts", erro: null }),
    "vivo"
  );
  assert.equal(
    classificar({ http: 200, bytes: 50000, kbps: 400, maiorLacunaMs: 1500, tipo: "ts", erro: null }),
    "instavel"
  );
  assert.equal(
    classificar({ http: 200, bytes: 50000, kbps: 800, maiorLacunaMs: 3500, tipo: "ts", erro: null }),
    "instavel"
  );
});

test("lerSondagens: descarta linhas vazias e inválidas", () => {
  const jsonl = [
    JSON.stringify({ canal: "C1", status: "vivo", rodada: 1 }),
    "",
    "linha invalida nao json",
    JSON.stringify({ algo: 123 }), // sem canal/status
    JSON.stringify({ canal: "C2", status: "morto", rodada: 1 }),
  ].join("\n");

  const { registros, invalidas } = lerSondagens(jsonl);
  assert.equal(registros.length, 2);
  assert.equal(invalidas, 2);
  assert.equal(registros[0].canal, "C1");
  assert.equal(registros[1].canal, "C2");
});

test("resumir: calcula métricas, quedas, vereditos e agregações familiares", () => {
  const registros = [
    // Canal A: 3 rodadas vivas -> estável
    { rodada: 1, canal: "Canal A HD", grupo: "G1", familia: "canal a", status: "vivo", kbps: 1000, ttfbMs: 100, bytes: 2000, paradas: 0, hostFinal: "h1" },
    { rodada: 2, canal: "Canal A HD", grupo: "G1", familia: "canal a", status: "vivo", kbps: 1200, ttfbMs: 120, bytes: 2000, paradas: 0, hostFinal: "h1" },
    { rodada: 3, canal: "Canal A HD", grupo: "G1", familia: "canal a", status: "vivo", kbps: 1100, ttfbMs: 110, bytes: 2000, paradas: 1, hostFinal: "h2" },

    // Canal B: vivo -> morto -> vivo -> instavel -> 2 quedas! cai-muito
    { rodada: 1, canal: "Canal B FHD", grupo: "G1", familia: "canal b", status: "vivo", kbps: 800, ttfbMs: 150, bytes: 1000, paradas: 0, hostFinal: "h1" },
    { rodada: 2, canal: "Canal B FHD", grupo: "G1", familia: "canal b", status: "morto", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h1" },
    { rodada: 3, canal: "Canal B FHD", grupo: "G1", familia: "canal b", status: "vivo", kbps: 700, ttfbMs: 140, bytes: 1000, paradas: 0, hostFinal: "h1" },
    { rodada: 4, canal: "Canal B FHD", grupo: "G1", familia: "canal b", status: "instavel", kbps: 400, ttfbMs: 200, bytes: 500, paradas: 2, hostFinal: "h1" },

    // Canal C: sempre morto
    { rodada: 1, canal: "Canal C", grupo: "G2", familia: "canal c", status: "morto", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h3" },
    { rodada: 2, canal: "Canal C", grupo: "G2", familia: "canal c", status: "morto", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h3" },
    { rodada: 3, canal: "Canal C", grupo: "G2", familia: "canal c", status: "morto", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h3" },

    // Canal D: >50% limitado -> sem-dados
    { rodada: 1, canal: "Canal D", grupo: "G2", familia: "canal d", status: "limitado", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h4" },
    { rodada: 2, canal: "Canal D", grupo: "G2", familia: "canal d", status: "limitado", kbps: 0, ttfbMs: null, bytes: 0, paradas: 0, hostFinal: "h4" },
    { rodada: 3, canal: "Canal D", grupo: "G2", familia: "canal d", status: "vivo", kbps: 600, ttfbMs: 100, bytes: 1000, paradas: 0, hostFinal: "h4" },
  ];

  const r = resumir(registros);
  assert.equal(r.rodadas, 4);

  const cA = r.canais.find((c) => c.canal === "Canal A HD");
  assert.ok(cA);
  assert.equal(cA.veredito, "estavel");
  assert.equal(cA.vivoPct, 100);
  assert.equal(cA.quedas, 0);
  assert.equal(cA.kbpsMediana, 1100);
  assert.equal(cA.paradasTotal, 1);
  assert.deepEqual(cA.hostsFinais.sort(), ["h1", "h2"]);

  const cB = r.canais.find((c) => c.canal === "Canal B FHD");
  assert.ok(cB);
  assert.equal(cB.quedas, 2);
  assert.equal(cB.veredito, "cai-muito");

  const cC = r.canais.find((c) => c.canal === "Canal C");
  assert.ok(cC);
  assert.equal(cC.veredito, "morto");

  const cD = r.canais.find((c) => c.canal === "Canal D");
  assert.ok(cD);
  assert.equal(cD.veredito, "sem-dados");

  // Famílias
  const fA = r.familias.find((f) => f.familia === "canal a");
  assert.ok(fA);
  assert.equal(fA.melhor, "Canal A HD");
  assert.equal(fA.algumVivo, true);

  const tabela = tabelaTexto(r);
  assert.ok(typeof tabela === "string");
  assert.ok(tabela.includes("Canal A HD"));
  assert.ok(tabela.includes("estavel"));
});

// --- Testes com servidor HTTP local para sondar e executarRodada ---

let server;
let baseUrl;

function criarMpegTsBuffer(pacotes = 10) {
  const buf = Buffer.alloc(188 * pacotes);
  for (let i = 0; i < pacotes; i++) {
    buf[i * 188] = 0x47;
    for (let j = 1; j < 188; j++) {
      buf[i * 188 + j] = (i + j) % 256;
    }
  }
  return buf;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/ts-bom") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      let count = 0;
      const interval = setInterval(() => {
        count++;
        res.write(criarMpegTsBuffer(50));
        if (count >= 15) {
          clearInterval(interval);
          res.end();
        }
      }, 50);
      req.on("close", () => clearInterval(interval));
      return;
    }

    if (url.pathname === "/ts-lento") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      let count = 0;
      const interval = setInterval(() => {
        count++;
        res.write(criarMpegTsBuffer(2));
        if (count >= 10) {
          clearInterval(interval);
          res.end();
        }
      }, 100);
      req.on("close", () => clearInterval(interval));
      return;
    }

    if (url.pathname === "/ts-trava") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.write(criarMpegTsBuffer(10));
      setTimeout(() => {
        res.write(criarMpegTsBuffer(10));
        res.end();
      }, 2500);
      return;
    }

    if (url.pathname === "/vazio-200") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.end();
      return;
    }

    if (url.pathname === "/erro-404") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    if (url.pathname === "/erro-429") {
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Rate Limit");
      return;
    }

    if (url.pathname === "/hls") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nsegment1.ts\n");
      return;
    }

    if (url.pathname === "/html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Blocked</body></html>");
      return;
    }

    if (url.pathname === "/redir-relativo") {
      res.writeHead(302, { Location: "/hls" });
      res.end();
      return;
    }

    if (url.pathname === "/redir-sem-location") {
      res.writeHead(302);
      res.end();
      return;
    }

    if (url.pathname === "/redir-loop") {
      res.writeHead(302, { Location: "/redir-loop" });
      res.end();
      return;
    }

    if (url.pathname === "/m3u-valida") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        [
          "#EXTM3U",
          '#EXTINF:-1 group-title="ESPORTES", ESPN 1 FHD',
          `${baseUrl}/live/usuario123/senha456/1.ts`,
          '#EXTINF:-1 group-title="VARIEDADES", Canal Variedades HD',
          `${baseUrl}/ts-bom`,
        ].join("\n")
      );
      return;
    }

    if (url.pathname === "/m3u-vazia") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("");
      return;
    }

    if (url.pathname.includes("/live/usuario123/senha456/1.ts")) {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.write(criarMpegTsBuffer(20));
      res.end();
      return;
    }
    if (url.pathname === "/segment1.ts" || url.pathname === "/segment2.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.write(criarMpegTsBuffer(10));
      res.end();
      return;
    }

    if (url.pathname === "/hls-mestre-404") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n/var-inexistente-404.m3u8\n");
      return;
    }

    if (url.pathname === "/var-inexistente-404.m3u8") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    if (url.pathname === "/hls-playlist-vazia") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:10\n");
      return;
    }

    if (url.pathname === "/hls-seg-404") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.0,\n/erro-404\n");
      return;
    }

    if (url.pathname === "/hls-seg-vazio") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.0,\n/vazio-200\n");
      return;
    }

    if (url.pathname === "/hls-seg-lento") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\n/seg-lento.ts\n");
      return;
    }

    if (url.pathname === "/seg-lento.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      setTimeout(() => {
        res.write(criarMpegTsBuffer(2));
        res.end();
      }, 250);
      return;
    }

    if (url.pathname === "/hls-cripto") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1/key"\n#EXTINF:1.0,\n/segment1.ts\n');
      return;
    }

    if (url.pathname === "/dir/hls-relativo") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n../segment1.ts\n");
      return;
    }

    if (url.pathname === "/hls-absoluto") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(`#EXTM3U\n#EXTINF:1.0,\n${baseUrl}/segment1.ts\n`);
      return;
    }

    if (url.pathname === "/hls-seg-redir") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n/seg-redir.ts\n");
      return;
    }

    if (url.pathname === "/seg-redir.ts") {
      res.writeHead(302, { Location: "/segment1.ts" });
      res.end();
      return;
    }

    if (url.pathname === "/hls-vod") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\n/segment1.ts\n#EXT-X-ENDLIST\n");
      return;
    }

    if (url.pathname === "/hls-ao-vivo-parado") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:0.15\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:0.5,\n/seg-ao-vivo.ts\n");
      return;
    }

    if (url.pathname === "/seg-ao-vivo.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      setTimeout(() => {
        res.write(criarMpegTsBuffer(2));
        res.end();
      }, 250);
      return;
    }

    if (url.pathname === "/hls-mestre-multi") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n/hls-variante1.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\n/hls-variante2.m3u8\n");
      return;
    }

    if (url.pathname === "/hls-variante1.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n/segment1.ts\n");
      return;
    }

    if (url.pathname === "/hls-variante2.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n/segment2.ts\n");
      return;
    }

    if (url.pathname === "/hls-servidor-cai") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n/seg-cai.ts\n");
      return;
    }

    if (url.pathname === "/seg-cai.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.write(Buffer.from("parcial"));
      setTimeout(() => {
        req.socket.destroy();
      }, 30);
      return;
    }

    if (url.pathname === "/live/hls-secreto/playlist.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXTINF:1.0,\n/live/usuario123/senha456/seg1.ts\n");
      return;
    }

    if (url.pathname === "/live/usuario123/senha456/seg1.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.write(criarMpegTsBuffer(5));
      res.end();
      return;
    }

    res.writeHead(400);
    res.end();
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("sondar: rota TS bom com kbps alto", async () => {
  const r = await sondar(`${baseUrl}/ts-bom`, { leituraMs: 700 });
  assert.equal(r.http, 200);
  assert.equal(r.tipo, "ts");
  assert.ok(r.bytes > 0);
  assert.ok(r.kbps >= 500, `kbps esperado >= 500, obtido ${r.kbps}`);
  assert.equal(r.erro, null);
  assert.equal(r.saltos, 0);
  assert.equal(r.hostFinal, new URL(baseUrl).host);
});

test("sondar: rota TS lento com kbps baixo", async () => {
  const r = await sondar(`${baseUrl}/ts-lento`, { leituraMs: 700 });
  assert.equal(r.http, 200);
  assert.equal(r.tipo, "ts");
  assert.ok(r.kbps < 500);
});

test("sondar: rota TS que trava registra lacuna >= 2000ms e parada", async () => {
  const r = await sondar(`${baseUrl}/ts-trava`, { leituraMs: 2800 });
  assert.equal(r.http, 200);
  assert.equal(r.tipo, "ts");
  assert.ok(r.paradas >= 1);
  assert.ok(r.maiorLacunaMs >= 2000);
});

test("sondar: rotas vazio, 404, 429, hls, html", async () => {
  const v = await sondar(`${baseUrl}/vazio-200`, { leituraMs: 500 });
  assert.equal(v.http, 200);
  assert.equal(v.tipo, "vazio");
  assert.equal(v.bytes, 0);

  const e404 = await sondar(`${baseUrl}/erro-404`, { leituraMs: 500 });
  assert.equal(e404.http, 404);

  const e429 = await sondar(`${baseUrl}/erro-429`, { leituraMs: 500 });
  assert.equal(e429.http, 429);

  const hls = await sondar(`${baseUrl}/hls`, { leituraMs: 500 });
  assert.equal(hls.http, 200);
  assert.equal(hls.tipo, "hls");

  const html = await sondar(`${baseUrl}/html`, { leituraMs: 500 });
  assert.equal(html.http, 200);
  assert.equal(html.tipo, "html");
});

test("sondar: redirecionamento relativo, loop e redirect sem Location", async () => {
  const rRel = await sondar(`${baseUrl}/redir-relativo`, { leituraMs: 500 });
  assert.equal(rRel.http, 200);
  assert.equal(rRel.saltos, 1);
  assert.equal(rRel.tipo, "hls");

  const rLoop = await sondar(`${baseUrl}/redir-loop`, { leituraMs: 500, maxSaltos: 3 });
  assert.equal(rLoop.erro, "muitos-saltos");
  assert.equal(rLoop.saltos, 3);

  const rSemLoc = await sondar(`${baseUrl}/redir-sem-location`, { leituraMs: 500 });
  assert.equal(rSemLoc.erro, "conexao");
});

test("sondar: servidor inexistente/porta fechada devolve erro de conexão sem lançar", async () => {
  const r = await sondar("http://127.0.0.1:1/nao-existe", { conexaoMs: 500, leituraMs: 500 });
  assert.equal(r.http, 0);
  assert.equal(r.erro, "conexao");
  assert.equal(r.bytes, 0);
});

test("executarRodada: concorrência respeitada, leitura prioritária e pausa em 429", async () => {
  let ativos = 0;
  let maxAtivos = 0;
  const gravações = [];

  const canais = [
    { nome: "ESPN FHD", grupo: "Esportes", url: "http://mock/1" },
    { nome: "ESPN 2 HD", grupo: "Esportes", url: "http://mock/2" },
    { nome: "Outro SD", grupo: "Variedades", url: "http://mock/3" },
    { nome: "Limitado Teste", grupo: "Esportes", url: "http://mock/4" },
  ];

  let tentativa429 = 0;
  const sondarMock = async (url, opts) => {
    ativos++;
    if (ativos > maxAtivos) maxAtivos = ativos;
    await new Promise((r) => setTimeout(r, 50));
    ativos--;

    if (url === "http://mock/4") {
      tentativa429++;
      if (tentativa429 === 1) {
        return { http: 429, saltos: 0, hostFinal: "mock", ttfbMs: 10, bytes: 0, kbps: 0, paradas: 0, maiorLacunaMs: 0, tipo: "vazio", erro: null };
      }
      return { http: 200, saltos: 0, hostFinal: "mock", ttfbMs: 10, bytes: 1000, kbps: 600, paradas: 0, maiorLacunaMs: 0, tipo: "ts", erro: null };
    }

    return {
      http: 200,
      saltos: 0,
      hostFinal: "mock",
      ttfbMs: 20,
      bytes: 2000,
      kbps: 800,
      paradas: 0,
      maiorLacunaMs: 50,
      tipo: "ts",
      erro: null,
    };
  };

  const resultado = await executarRodada(canais, {
    rodada: 1,
    leituraPadraoMs: 500,
    leituraPrioritariaMs: 1000,
    prioritarios: /^espn/i,
    concorrencia: 2,
    sondarFn: sondarMock,
    gravar: (reg) => gravações.push(reg),
    pausaLimiteMs: 100,
  });

  assert.ok(maxAtivos <= 2, `Máximo de concorrência foi ${maxAtivos}, esperado <= 2`);
  assert.equal(resultado.total, 4);
  assert.equal(gravações.length, 4);
  const regLim = gravações.find((g) => g.canal === "Limitado Teste");
  assert.ok(regLim);
  assert.equal(regLim.status, "vivo");
});

test("segredo: URL e credenciais NUNCA aparecem nos registros gravados", async () => {
  const urlSecretaTs = `${baseUrl}/live/usuario123/senha456/1.ts`;
  const urlSecretaHls = `${baseUrl}/live/hls-secreto/playlist.m3u8`;
  const canais = [
    { nome: "Canal Secreto TS", grupo: "Privado", url: urlSecretaTs },
    { nome: "Canal Secreto HLS", grupo: "Privado", url: urlSecretaHls },
  ];

  const gravados = [];
  await executarRodada(canais, {
    rodada: 1,
    leituraPadraoMs: 600,
    leituraPrioritariaMs: 600,
    prioritarios: null,
    concorrencia: 1,
    gravar: (r) => gravados.push(r),
  });

  const textoGravado = JSON.stringify(gravados);
  assert.ok(!textoGravado.includes("usuario123"), "Credencial usuario123 vazou!");
  assert.ok(!textoGravado.includes("senha456"), "Credencial senha456 vazou!");
  assert.ok(!textoGravado.includes("/live/"), "Caminho da URL vazou!");
  assert.ok(!textoGravado.includes("seg1.ts"), "Nome do segmento vazou!");
});

// --- Testes da CLI e verificações de entradas inválidas/ausentes ---

test("CLI listar: parâmetros ausentes ou inválidos", async () => {
  // --env-file ausente
  await assert.rejects(
    async () => await runCli(["listar"]),
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes("--env-file ausente"));
      return true;
    }
  );

  // Arquivo inexistente
  await assert.rejects(
    async () => await runCli(["listar", "--env-file", "arquivo-inexistente.env"]),
    (err) => {
      assert.equal(err.code, 1);
      assert.ok(err.stderr.includes("arquivo de ambiente inexistente"));
      return true;
    }
  );
});

test("CLI listar: sucesso e contagem de grupos sem vazar URL", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  const envFile = path.join(tempDir, "teste.env");
  fs.writeFileSync(
    envFile,
    `OTT_CONTA_CANAIS="${baseUrl}/m3u-valida"\n`,
    "utf-8"
  );

  try {
    const { stdout, stderr } = await runCli([
      "listar",
      "--env-file",
      envFile,
    ]);

    assert.equal(stderr, "");
    assert.ok(stdout.includes("ESPORTES: 1"));
    assert.ok(stdout.includes("VARIEDADES: 1"));
    assert.ok(!stdout.includes("usuario123"));
    assert.ok(!stdout.includes("senha456"));
    assert.ok(!stdout.includes(baseUrl));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI listar: lista vazia ou HTML retorna código 1 e mensagem 'nenhum canal'", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  const envVazia = path.join(tempDir, "vazia.env");
  const envHtml = path.join(tempDir, "html.env");

  fs.writeFileSync(envVazia, `OTT_CONTA_CANAIS="${baseUrl}/m3u-vazia"\n`, "utf-8");
  fs.writeFileSync(envHtml, `OTT_CONTA_CANAIS="${baseUrl}/html"\n`, "utf-8");

  try {
    await assert.rejects(
      async () => await runCli(["listar", "--env-file", envVazia]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("nenhum canal"));
        assert.ok(!err.stderr.includes(baseUrl));
        return true;
      }
    );

    await assert.rejects(
      async () => await runCli(["listar", "--env-file", envHtml]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("nenhum canal"));
        assert.ok(!err.stderr.includes(baseUrl));
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI monitorar: validação de argumentos obrigatórios e numéricos", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  const envFile = path.join(tempDir, "teste.env");
  fs.writeFileSync(envFile, `OTT_CONTA_CANAIS="${baseUrl}/m3u-valida"\n`, "utf-8");

  try {
    // --grupos ausente
    await assert.rejects(
      async () =>
        await runCli([
          "monitorar",
          "--env-file",
          envFile,
          "--out",
          tempDir,
        ]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("--grupos ausente ou vazio"));
        return true;
      }
    );

    // --minutos inválido
    await assert.rejects(
      async () =>
        await runCli([
          "monitorar",
          "--env-file",
          envFile,
          "--grupos",
          "ESPORTES",
          "--out",
          tempDir,
          "--minutos",
          "0",
        ]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("--minutos"));
        return true;
      }
    );

    // --intervalo inválido
    await assert.rejects(
      async () =>
        await runCli([
          "monitorar",
          "--env-file",
          envFile,
          "--grupos",
          "ESPORTES",
          "--out",
          tempDir,
          "--intervalo",
          "0",
        ]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("--intervalo"));
        return true;
      }
    );

    // --leitura inválida
    await assert.rejects(
      async () =>
        await runCli([
          "monitorar",
          "--env-file",
          envFile,
          "--grupos",
          "ESPORTES",
          "--out",
          tempDir,
          "--leitura",
          "-1",
        ]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("--leitura"));
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI monitorar e resumir: execução completa, arquivos gerados e verificação de segredo", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-full-"));
  const envFile = path.join(tempDir, "teste.env");
  const outDir = path.join(tempDir, "saida-monitor");

  fs.writeFileSync(
    envFile,
    `OTT_CONTA_CANAIS="${baseUrl}/m3u-valida"\n`,
    "utf-8"
  );

  try {
    // Roda monitorar com minutos pequeno (ex.: 0.05 min = 3s)
    const { stdout, stderr } = await runCli([
      "monitorar",
      "--env-file",
      envFile,
      "--grupos",
      "ESPORTES",
      "--out",
      outDir,
      "--rotulo",
      "teste",
      "--minutos",
      "0.05",
      "--intervalo",
      "1",
      "--leitura",
      "1",
      "--concorrencia",
      "5", // testa aviso de concorrencia > 4
    ]);

    assert.ok(stderr.includes("concorrencia maxima permitida e 4"));
    assert.ok(stdout.includes("Rodada 1/1: 1 canais"));

    const arquivoSondagens = path.join(outDir, "sondagens-teste.jsonl");
    const arquivoEstado = path.join(outDir, "estado-teste.json");

    assert.ok(fs.existsSync(arquivoSondagens), "sondagens-teste.jsonl deve existir");
    assert.ok(fs.existsSync(arquivoEstado), "estado-teste.json deve existir");

    const conteudoSondagens = fs.readFileSync(arquivoSondagens, "utf-8");
    const conteudoEstado = fs.readFileSync(arquivoEstado, "utf-8");

    // Validação de segredo em todo o ecossistema CLI
    const saidaTotal = stdout + stderr + conteudoSondagens + conteudoEstado;
    assert.ok(!saidaTotal.includes("usuario123"), "usuario123 vazou!");
    assert.ok(!saidaTotal.includes("senha456"), "senha456 vazou!");
    assert.ok(!saidaTotal.includes("/live/"), "caminho de stream vazou!");

    // Teste do subcomando resumir
    const { stdout: stdoutResumo } = await runCli([
      "resumir",
      "--out",
      outDir,
      "--rotulo",
      "teste",
    ]);

    assert.ok(stdoutResumo.includes("FAMÍLIA"));
    assert.ok(stdoutResumo.includes("ESPN 1 FHD"));
    const arquivoResumo = path.join(outDir, "resumo.json");
    assert.ok(fs.existsSync(arquivoResumo));

    // Validação de segredo no resumo
    const conteudoResumo = fs.readFileSync(arquivoResumo, "utf-8");
    assert.ok(!conteudoResumo.includes("usuario123"));
    assert.ok(!conteudoResumo.includes("senha456"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI resumir: pasta vazia ou sem arquivos deve sair com código 1 e mensagem 'sem dados'", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resumo-"));

  try {
    await assert.rejects(
      async () => await runCli(["resumir", "--out", tempDir]),
      (err) => {
        assert.equal(err.code, 1);
        assert.ok(err.stderr.includes("sem dados"));
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Testes da especificação HLS e filtros por nome ---

test("filtrarCanais: suporte a incluir e grupos *", () => {
  const canais = [
    { nome: "ESPN 1 FHD", grupo: "Esportes", url: "http://a.com/1" },
    { nome: "ESPN 2 HD", grupo: "VARIEDADES", url: "http://a.com/2" },
    { nome: "Fox Sports HD", grupo: "Esportes", url: "http://a.com/3" },
    { nome: "Globo RJ", grupo: "Abertos", url: "http://a.com/4" },
  ];

  // grupos * com incluir espn
  const r1 = filtrarCanais(canais, { grupos: ["*"], incluir: ["espn"] });
  assert.equal(r1.length, 2);
  assert.equal(r1[0].nome, "ESPN 1 FHD");
  assert.equal(r1[1].nome, "ESPN 2 HD");

  // incluir vazio ou ausente -> nenhum filtro por nome
  const r2 = filtrarCanais(canais, { grupos: ["esportes"], incluir: [] });
  assert.equal(r2.length, 2);

  const r3 = filtrarCanais(canais, { grupos: ["esportes"] });
  assert.equal(r3.length, 2);

  // grupos específico + incluir + excluir combinados
  const r4 = filtrarCanais(canais, {
    grupos: ["esportes"],
    incluir: ["espn"],
    excluir: ["1"],
  });
  assert.equal(r4.length, 0);
});

test("classificar: suporte a registros novos HLS com segmentos e registros antigos", () => {
  // Registro antigo (sem campo segmentos)
  assert.equal(classificar({ http: 200, tipo: "hls", bytes: 100 }), "vivo");
  assert.equal(classificar({ http: 500, tipo: "hls", bytes: 100 }), "morto");

  // Registro novo com segmentos
  // segmentos === 0 ou bytes === 0 -> morto
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 0, bytes: 0, erro: "playlist-http-404" }),
    "morto"
  );
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 0, bytes: 0, erro: "playlist-vazia" }),
    "morto"
  );
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 2, bytes: 0, erro: null }),
    "morto"
  );

  // paradas > 0 ou velocidadeX < 1 ou erro preenchido com segmentos > 0 -> instavel
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 2, bytes: 1000, paradas: 1, velocidadeX: 1.5, erro: null }),
    "instavel"
  );
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 2, bytes: 1000, paradas: 0, velocidadeX: 0.8, erro: null }),
    "instavel"
  );
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 1, bytes: 1000, paradas: 0, velocidadeX: 1.2, erro: "segmento-http-404" }),
    "instavel"
  );

  // Tudo ok -> vivo
  assert.equal(
    classificar({ http: 200, tipo: "hls", segmentos: 2, bytes: 5000, paradas: 0, velocidadeX: 1.5, erro: null }),
    "vivo"
  );
});

test("sondar HLS: mestre com variante 404 retorna playlist-http-404, status morto e segmentos 0", async () => {
  const s = await sondar(`${baseUrl}/hls-mestre-404`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, "playlist-http-404");
  assert.equal(s.segmentos, 0);
  assert.equal(s.bytes, 0);
  assert.equal(classificar(s), "morto");
});

test("sondar HLS: playlist vazia retorna playlist-vazia e bytes 0", async () => {
  const s = await sondar(`${baseUrl}/hls-playlist-vazia`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, "playlist-vazia");
  assert.equal(s.bytes, 0);
  assert.equal(s.segmentos, 0);
  assert.equal(classificar(s), "morto");
});

test("sondar HLS: segmento com 404 retorna segmento-http-404", async () => {
  const s = await sondar(`${baseUrl}/hls-seg-404`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, "segmento-http-404");
  assert.equal(s.segmentos, 0);
  assert.equal(classificar(s), "morto");
});

test("sondar HLS: segmento com 0 bytes retorna segmento-vazio", async () => {
  const s = await sondar(`${baseUrl}/hls-seg-vazio`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, "segmento-vazio");
  assert.equal(s.segmentos, 0);
  assert.equal(classificar(s), "morto");
});

test("sondar HLS: segmento lento incrementa paradas e velocidadeX < 1 classifica instavel", async () => {
  const s = await sondar(`${baseUrl}/hls-seg-lento`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.ok(s.segmentos >= 1);
  assert.ok(s.paradas >= 1);
  assert.ok(s.velocidadeX < 1);
  assert.equal(classificar(s), "instavel");
});

test("sondar HLS: segmentos criptografados baixa bytes normalmente", async () => {
  const s = await sondar(`${baseUrl}/hls-cripto`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, null);
  assert.ok(s.segmentos >= 1);
  assert.ok(s.bytes > 0);
  assert.ok(s.velocidadeX >= 1);
  assert.equal(classificar(s), "vivo");
});

test("sondar HLS: suporte a URIs relativos e absolutos", async () => {
  const sRel = await sondar(`${baseUrl}/dir/hls-relativo`, { leituraMs: 2000 });
  assert.equal(sRel.tipo, "hls");
  assert.equal(sRel.erro, null);
  assert.ok(sRel.segmentos >= 1);
  assert.ok(sRel.bytes > 0);

  const sAbs = await sondar(`${baseUrl}/hls-absoluto`, { leituraMs: 2000 });
  assert.equal(sAbs.tipo, "hls");
  assert.equal(sAbs.erro, null);
  assert.ok(sAbs.segmentos >= 1);
  assert.ok(sAbs.bytes > 0);
});

test("sondar HLS: redirecionamento 302 no segmento", async () => {
  const s = await sondar(`${baseUrl}/hls-seg-redir`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, null);
  assert.ok(s.segmentos >= 1);
  assert.ok(s.bytes > 0);
});

test("sondar HLS: lista VOD com #EXT-X-ENDLIST", async () => {
  const s = await sondar(`${baseUrl}/hls-vod`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, null);
  assert.ok(s.segmentos >= 1);
  assert.ok(s.bytes > 0);
  assert.equal(s.paradas, 0);
});

test("sondar HLS: playlist ao vivo parada incrementa paradas", async () => {
  // TARGETDURATION é 0.2s, 1.5 * TARGETDURATION = 0.3s. Com leituraMs de 1500ms, cabe a releitura.
  const s = await sondar(`${baseUrl}/hls-ao-vivo-parado`, { leituraMs: 1500 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, null);
  assert.ok(s.segmentos >= 1);
  assert.ok(s.paradas >= 1, "Deveria identificar lista parada e somar parada");
  assert.equal(classificar(s), "instavel");
});

test("sondar HLS: manifesto mestre com multiplas variantes escolhe a primeira", async () => {
  const s = await sondar(`${baseUrl}/hls-mestre-multi`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.equal(s.erro, null);
  assert.ok(s.segmentos >= 1);
  assert.ok(s.bytes > 0);
});

test("sondar HLS: servidor que cai no meio do download de segmento preenche erro sem excecao", async () => {
  const s = await sondar(`${baseUrl}/hls-servidor-cai`, { leituraMs: 2000 });
  assert.equal(s.tipo, "hls");
  assert.ok(s.erro === "conexao" || s.erro === "timeout");
  assert.equal(classificar(s), "morto");
});

test("resumir e tabelaTexto: registro antigo e novo juntos, calcula velocidadeX e exibe coluna X", () => {
  const registros = [
    // Registro antigo (sem velocidadeX)
    {
      rodada: 1,
      canal: "Canal HLS",
      grupo: "Canais",
      familia: "canal hls",
      status: "vivo",
      http: 200,
      bytes: 2000,
      kbps: 1500,
      tipo: "hls",
      ttfbMs: 100,
    },
    // Registro novo com velocidadeX
    {
      rodada: 2,
      canal: "Canal HLS",
      grupo: "Canais",
      familia: "canal hls",
      status: "vivo",
      http: 200,
      bytes: 4000,
      kbps: 2000,
      tipo: "hls",
      segmentos: 2,
      velocidadeX: 2.4,
      ttfbMs: 80,
    },
    {
      rodada: 3,
      canal: "Canal HLS",
      grupo: "Canais",
      familia: "canal hls",
      status: "vivo",
      http: 200,
      bytes: 4000,
      kbps: 2000,
      tipo: "hls",
      segmentos: 2,
      velocidadeX: 2.8,
      ttfbMs: 90,
    },
    // Canal só com registros TS antigos (sem velocidadeX)
    {
      rodada: 1,
      canal: "Canal TS",
      grupo: "Canais",
      familia: "canal ts",
      status: "vivo",
      http: 200,
      bytes: 10000,
      kbps: 800,
      tipo: "ts",
      ttfbMs: 120,
    },
  ];

  const r = resumir(registros);
  const canalHls = r.canais.find((c) => c.canal === "Canal HLS");
  const canalTs = r.canais.find((c) => c.canal === "Canal TS");

  assert.ok(canalHls);
  // Média de 2.4 e 2.8 é 2.6
  assert.equal(canalHls.velocidadeX, 2.6);
  assert.equal(canalTs.velocidadeX, null);

  const tabela = tabelaTexto(r);
  assert.ok(tabela.includes(" X "));
  assert.ok(tabela.includes("2.6"));
  assert.ok(tabela.includes("-"));
});

test("CLI listar: suporte a --grupos, --incluir e --nomes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-listar-"));
  const envFile = path.join(tempDir, "teste.env");
  fs.writeFileSync(envFile, `OTT_CONTA_CANAIS="${baseUrl}/m3u-valida"\n`, "utf-8");

  try {
    // Sem --nomes, imprime contagem por grupo
    const { stdout: sContagem } = await runCli([
      "listar",
      "--env-file",
      envFile,
      "--grupos",
      "*",
      "--incluir",
      "espn",
    ]);
    assert.ok(sContagem.includes("ESPORTES: 1"));
    assert.ok(!sContagem.includes("VARIEDADES"));

    // Com --nomes, imprime os nomes dos canais um por linha sem URL
    const { stdout: sNomes } = await runCli([
      "listar",
      "--env-file",
      envFile,
      "--grupos",
      "*",
      "--incluir",
      "espn",
      "--nomes",
    ]);
    assert.ok(sNomes.includes("ESPN 1 FHD"));
    assert.ok(!sNomes.includes("VARIEDADES"));
    assert.ok(!sNomes.includes("http://"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executarRodada: sondagem que nunca responde vira 'travou' e a rodada termina (não prende a conexão do monitor)", async () => {
  const registros = [];
  const canais = [
    { nome: "Canal Preso", grupo: "g", url: "http://x/1" },
    { nome: "Canal Bom", grupo: "g", url: "http://x/2" },
  ];
  const sondarFn = (url) => {
    if (url.endsWith("/1")) return new Promise(() => {}); // nunca resolve
    return Promise.resolve({ http: 200, saltos: 0, hostFinal: "h", ttfbMs: 5, bytes: 100000, kbps: 2000, paradas: 0, maiorLacunaMs: 10, tipo: "ts", erro: null });
  };
  const t0 = Date.now();
  const r = await executarRodada(canais, {
    rodada: 1, leituraPadraoMs: 50, leituraPrioritariaMs: 50, prioritarios: null, concorrencia: 1,
    sondarFn, gravar: (x) => registros.push(x), pausaLimiteMs: 10, tetoExtraMs: 150,
  });
  assert.ok(Date.now() - t0 < 3000, "a rodada não pode esperar para sempre");
  assert.equal(r.total, 2);
  const preso = registros.find((x) => x.canal === "Canal Preso");
  assert.equal(preso.status, "morto");
  assert.equal(preso.erro, "travou");
  assert.equal(registros.find((x) => x.canal === "Canal Bom").status, "vivo");
});
