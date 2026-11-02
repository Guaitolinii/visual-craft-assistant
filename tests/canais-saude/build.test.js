import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  saudeChave,
  gerarSaude,
} from "../../scripts/canais-saude/build.mjs";

const execFileAsync = promisify(execFile);
const buildCliPath = path.resolve("scripts/canais-saude/build.mjs");

function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [buildCliPath, ...args], {
    env: { ...process.env, ...env },
  });
}

// Servidor local para simular fluxos reais de rede sem acessar internet
let server;
let serverPort;
let serverBaseUrl;

// Gera 188 * N bytes simulando pacotes TS válidos (cada um começa com 0x47)
function gerarBufferTs(qtdPacotes = 10) {
  const buf = Buffer.alloc(188 * qtdPacotes);
  for (let i = 0; i < qtdPacotes; i++) {
    buf[i * 188] = 0x47;
  }
  return buf;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);

    if (url.pathname === "/parked") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>This domain is parked. Buy it now!</body></html>");
      return;
    }

    if (url.pathname === "/xui") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>NOT_IN_BOUQUET</body></html>");
      return;
    }

    if (url.pathname === "/404") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    if (url.pathname === "/503") {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service Unavailable");
      return;
    }

    if (url.pathname === "/403") {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (url.pathname === "/429") {
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too Many Requests");
      return;
    }

    if (url.pathname === "/timeout") {
      // Deixa a requisição pendente sem responder
      return;
    }

    if (url.pathname === "/hls/master.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4.0,\nsegment.ts\n"
      );
      return;
    }

    if (url.pathname === "/hls/segment.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.end(gerarBufferTs(20));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = server.address().port;
  serverBaseUrl = `http://127.0.0.1:${serverPort}`;
});

after(() => {
  if (server) {
    server.close();
  }
});

// --- Testes unitários das regras de especificação ---

test("Acentos/caixa: 'Séries  Premiére 1 HD' → chave 'series premiere 1 hd'", () => {
  assert.equal(saudeChave("Séries  Premiére 1 HD"), "series premiere 1 hd");
  assert.equal(saudeChave("  ESPN   BRASIL  FHD  "), "espn brasil fhd");
  assert.equal(saudeChave("Combate 4K"), "combate 4k");
  assert.equal(saudeChave(""), "");
});

test("Lista vazia, HTML, 3 canais só (<10) → saude: null / arquivo de saída NÃO é alterado", async () => {
  // Lista com menos de 10 canais
  const canaisPoucos = [
    { nome: "ESPN", grupo: "Esportes", url: "http://host1.com/1" },
    { nome: "Sportv", grupo: "Esportes", url: "http://host1.com/2" },
    { nome: "Fox Sports", grupo: "Esportes", url: "http://host1.com/3" },
  ];

  const resPoucos = await gerarSaude({
    canais: canaisPoucos,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: async () => ({ tipo: "ts", http: 200, kbps: 2000, maiorLacunaMs: 100, erro: null }),
  });

  assert.equal(resPoucos.saude, null);
  assert.equal(resPoucos.resumo.bloqueado, false);
  assert.equal(resPoucos.resumo.total, 3);

  // Lista vazia
  const resVazia = await gerarSaude({
    canais: [],
    anterior: null,
    agoraS: 1700000000,
  });
  assert.equal(resVazia.saude, null);
  assert.equal(resVazia.resumo.total, 0);
});

test("Servidor com domínio estacionado (3 amostras dominio-estacionado) → todos saem removido com servidor-dominio-estacionado, esporte sai com dominio-estacionado", async () => {
  // Servidor host1 tem 6 canais (minCanaisPorHost = 6)
  // Canal 0 é esporte; canais 1 a 5 não são esportes
  const canais = [
    { nome: "ESPN FHD", grupo: "Esportes", url: "http://host1.local/live/1.ts" },
    { nome: "Noticias 1", grupo: "Variedades", url: "http://host1.local/live/2.ts" },
    { nome: "Noticias 2", grupo: "Variedades", url: "http://host1.local/live/3.ts" },
    { nome: "Noticias 3", grupo: "Variedades", url: "http://host1.local/live/4.ts" },
    { nome: "Noticias 4", grupo: "Variedades", url: "http://host1.local/live/5.ts" },
    { nome: "Noticias 5", grupo: "Variedades", url: "http://host1.local/live/6.ts" },
    // Outro servidor para bater >= 10 canais
    { nome: "Outro 1", grupo: "Filmes", url: "http://host2.local/1.ts" },
    { nome: "Outro 2", grupo: "Filmes", url: "http://host2.local/2.ts" },
    { nome: "Outro 3", grupo: "Filmes", url: "http://host2.local/3.ts" },
    { nome: "Outro 4", grupo: "Filmes", url: "http://host2.local/4.ts" },
  ];

  const fakeSondar = async (url) => {
    if (url.includes("host1.local")) {
      return {
        tipo: "html",
        http: 200,
        bytes: 100,
        kbps: 0,
        maiorLacunaMs: 0,
        erro: "dominio-estacionado",
      };
    }
    return {
      tipo: "ts",
      http: 200,
      bytes: 50000,
      kbps: 1500,
      maiorLacunaMs: 200,
      erro: null,
    };
  };

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
    config: {
      grupos: ["Esportes"],
      nomes: [],
      amostrasPorHost: 3,
      minCanaisPorHost: 6,
      concorrencia: 1,
      maxFalhaPct: 90,
    },
  });

  assert.ok(saude);
  assert.equal(resumo.servidoresRemovidos, 1);

  // Canal de esporte do servidor estacionado tem motivo direto "dominio-estacionado"
  assert.deepEqual(saude.canais["espn fhd"], {
    e: "removido",
    d: 1700000000,
    m: "dominio-estacionado",
  });

  // Demais canais do servidor recebem motivo "servidor-dominio-estacionado"
  assert.deepEqual(saude.canais["noticias 1"], {
    e: "removido",
    d: 1700000000,
    m: "servidor-dominio-estacionado",
  });
  assert.deepEqual(saude.canais["noticias 5"], {
    e: "removido",
    d: 1700000000,
    m: "servidor-dominio-estacionado",
  });

  // Canais do host2 não foram marcados
  assert.equal(saude.canais["outro 1"], undefined);
});

test("Servidor com 2 amostras 404 e 1 amostra viva → nenhum canal marcado por servidor", async () => {
  const canais = [
    { nome: "Canal A", grupo: "Filmes", url: "http://host1.local/1.ts" }, // amostra 0
    { nome: "Canal B", grupo: "Filmes", url: "http://host1.local/2.ts" },
    { nome: "Canal C", grupo: "Filmes", url: "http://host1.local/3.ts" }, // amostra 3 (meio)
    { nome: "Canal D", grupo: "Filmes", url: "http://host1.local/4.ts" },
    { nome: "Canal E", grupo: "Filmes", url: "http://host1.local/5.ts" },
    { nome: "Canal F", grupo: "Filmes", url: "http://host1.local/6.ts" }, // amostra 5 (fim)
    { nome: "Extra 1", grupo: "Geral", url: "http://host2.local/1.ts" },
    { nome: "Extra 2", grupo: "Geral", url: "http://host2.local/2.ts" },
    { nome: "Extra 3", grupo: "Geral", url: "http://host2.local/3.ts" },
    { nome: "Extra 4", grupo: "Geral", url: "http://host2.local/4.ts" },
  ];

  const fakeSondar = async (url) => {
    if (url === "http://host1.local/1.ts") {
      return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" };
    }
    if (url === "http://host1.local/4.ts") {
      return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" };
    }
    // Uma amostra viva
    return { tipo: "ts", http: 200, bytes: 50000, kbps: 2000, maiorLacunaMs: 100, erro: null };
  };

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
    config: {
      grupos: ["Esportes"],
      nomes: [],
      amostrasPorHost: 3,
      minCanaisPorHost: 6,
      concorrencia: 1,
      maxFalhaPct: 90,
    },
  });

  assert.ok(saude);
  assert.equal(resumo.servidoresRemovidos, 0);
  assert.deepEqual(saude.canais, {});
});

test("Canal com xui-not_in_bouquet → removido só ele (outros canais do mesmo servidor não são marcados)", async () => {
  const canais = [
    { nome: "ESPN 1", grupo: "Esportes", url: "http://host1.local/live/1.ts" },
    { nome: "Canal 2", grupo: "Variedades", url: "http://host1.local/live/2.ts" },
    { nome: "Canal 3", grupo: "Variedades", url: "http://host1.local/live/3.ts" },
    { nome: "Canal 4", grupo: "Variedades", url: "http://host1.local/live/4.ts" },
    { nome: "Canal 5", grupo: "Variedades", url: "http://host1.local/live/5.ts" },
    { nome: "Canal 6", grupo: "Variedades", url: "http://host1.local/live/6.ts" },
    { nome: "Canal 7", grupo: "Variedades", url: "http://host1.local/live/7.ts" },
    { nome: "Canal 8", grupo: "Variedades", url: "http://host1.local/live/8.ts" },
    { nome: "Canal 9", grupo: "Variedades", url: "http://host1.local/live/9.ts" },
    { nome: "Canal 10", grupo: "Variedades", url: "http://host1.local/live/10.ts" },
  ];

  const fakeSondar = async (url) => {
    if (url === "http://host1.local/live/1.ts") {
      return {
        tipo: "html",
        http: 200,
        bytes: 100,
        kbps: 0,
        maiorLacunaMs: 0,
        erro: "xui-not_in_bouquet",
      };
    }
    // Demais amostras do servidor
    return {
      tipo: "html",
      http: 200,
      bytes: 100,
      kbps: 0,
      maiorLacunaMs: 0,
      erro: "xui-not_in_bouquet",
    };
  };

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
    config: {
      grupos: ["Esportes"],
      nomes: [],
      amostrasPorHost: 3,
      minCanaisPorHost: 6,
      concorrencia: 1,
      maxFalhaPct: 90,
    },
  });

  assert.ok(saude);
  // xui-* NÃO conta para servidor inteiro
  assert.equal(resumo.servidoresRemovidos, 0);
  assert.deepEqual(saude.canais["espn 1"], {
    e: "removido",
    d: 1700000000,
    m: "xui-not_in_bouquet",
  });
  // Canais não-esporte do servidor não foram marcados
  assert.equal(saude.canais["canal 2"], undefined);
  assert.equal(saude.canais["canal 6"], undefined);
});

test("Timeout, http-403, http-503, segmento-http-404, travou → instavel, nunca removido", async () => {
  const canais = [
    { nome: "Canal Timeout", grupo: "Esportes", url: "http://h.com/1" },
    { nome: "Canal 403", grupo: "Esportes", url: "http://h.com/2" },
    { nome: "Canal 503", grupo: "Esportes", url: "http://h.com/3" },
    { nome: "Canal Seg404", grupo: "Esportes", url: "http://h.com/4" },
    { nome: "Canal Travou", grupo: "Esportes", url: "http://h.com/5" },
    { nome: "Futebol de Rua", grupo: "Outros", url: "http://h.com/6" }, // por nome
    { nome: "C7", grupo: "Geral", url: "http://h.com/7" },
    { nome: "C8", grupo: "Geral", url: "http://h.com/8" },
    { nome: "C9", grupo: "Geral", url: "http://h.com/9" },
    { nome: "C10", grupo: "Geral", url: "http://h.com/10" },
  ];

  const fakeSondar = async (url) => {
    if (url.endsWith("/1")) return { tipo: "vazio", http: 0, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "timeout" };
    if (url.endsWith("/2")) return { tipo: "vazio", http: 403, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-403" };
    if (url.endsWith("/3")) return { tipo: "vazio", http: 503, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-503" };
    if (url.endsWith("/4")) return { tipo: "hls", http: 200, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "segmento-http-404" };
    if (url.endsWith("/5")) return { tipo: "vazio", http: 0, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "travou" };
    if (url.endsWith("/6")) return { tipo: "ts", http: 200, bytes: 50000, kbps: 2000, maiorLacunaMs: 100, erro: null };
    return { tipo: "ts", http: 200, bytes: 50000, kbps: 2000, maiorLacunaMs: 100, erro: null };
  };

  const { saude } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
  });

  assert.ok(saude);
  assert.equal(saude.canais["canal timeout"].e, "instavel");
  assert.equal(saude.canais["canal timeout"].m, "timeout");

  assert.equal(saude.canais["canal 403"].e, "instavel");
  assert.equal(saude.canais["canal 403"].m, "http-403");

  assert.equal(saude.canais["canal 503"].e, "instavel");
  assert.equal(saude.canais["canal 503"].m, "http-503");

  assert.equal(saude.canais["canal seg404"].e, "instavel");
  assert.equal(saude.canais["canal seg404"].m, "segmento-http-404");

  assert.equal(saude.canais["canal travou"].e, "instavel");
  assert.equal(saude.canais["canal travou"].m, "travou");
});

test("limitado (429) → mantém o estado anterior; sem anterior, fica de fora", async () => {
  const canais = [
    { nome: "Canal Lim 1", grupo: "Esportes", url: "http://h.com/1" },
    { nome: "Canal Lim 2", grupo: "Esportes", url: "http://h.com/2" },
    { nome: "C3", grupo: "G", url: "http://h.com/3" },
    { nome: "C4", grupo: "G", url: "http://h.com/4" },
    { nome: "C5", grupo: "G", url: "http://h.com/5" },
    { nome: "C6", grupo: "G", url: "http://h.com/6" },
    { nome: "C7", grupo: "G", url: "http://h.com/7" },
    { nome: "C8", grupo: "G", url: "http://h.com/8" },
    { nome: "C9", grupo: "G", url: "http://h.com/9" },
    { nome: "C10", grupo: "G", url: "http://h.com/10" },
  ];

  const anterior = {
    v: 1,
    gerado: 1690000000,
    canais: {
      "canal lim 1": { e: "removido", d: 1680000000, m: "http-404" },
    },
  };

  const fakeSondar = async () => ({
    tipo: "vazio",
    http: 429,
    bytes: 0,
    kbps: 0,
    maiorLacunaMs: 0,
    erro: null,
  });

  const { saude } = await gerarSaude({
    canais,
    anterior,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
  });

  assert.ok(saude);
  // Canal Lim 1 manteve estado anterior
  assert.deepEqual(saude.canais["canal lim 1"], {
    e: "removido",
    d: 1680000000,
    m: "http-404",
  });
  // Canal Lim 2 não tinha anterior, ficou de fora
  assert.equal(saude.canais["canal lim 2"], undefined);
});

test("Mais de 90% das sondagens com erro de rede → saude: null, bloqueado: true", async () => {
  // 10 canais de esporte; 10 sondados; todos falham com 'conexao'
  const canais = Array.from({ length: 10 }, (_, i) => ({
    nome: `Esporte ${i + 1}`,
    grupo: "Esportes",
    url: `http://servidor.local/${i + 1}`,
  }));

  const fakeSondar = async () => ({
    tipo: "vazio",
    http: 0,
    bytes: 0,
    kbps: 0,
    maiorLacunaMs: 0,
    erro: "conexao",
  });

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
    config: { maxFalhaPct: 90 },
  });

  assert.equal(saude, null);
  assert.equal(resumo.bloqueado, true);
});

test("d preservado quando o estado não mudou; d = agora quando mudou; entradas que sumiram são descartadas", async () => {
  const canais = [
    { nome: "Canal Sem Mudanca", grupo: "Esportes", url: "http://h.com/1" },
    { nome: "Canal Mudou", grupo: "Esportes", url: "http://h.com/2" },
    { nome: "Canal Novo", grupo: "Esportes", url: "http://h.com/3" },
    ...Array.from({ length: 7 }, (_, i) => ({
      nome: `Outro ${i}`,
      grupo: "Filmes",
      url: `http://h.com/out/${i}`,
    })),
  ];

  const anterior = {
    v: 1,
    gerado: 1690000000,
    canais: {
      "canal sem mudanca": { e: "removido", d: 1650000000, m: "http-404" },
      "canal mudou": { e: "instavel", d: 1650000000, m: "timeout" },
      "canal que sumiu da lista": { e: "removido", d: 1650000000, m: "http-404" },
    },
  };

  const fakeSondar = async (url) => {
    if (url.endsWith("/1")) return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" };
    if (url.endsWith("/2")) return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" }; // mudou de instavel para removido
    if (url.endsWith("/3")) return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" }; // novo
    return { tipo: "ts", http: 200, bytes: 50000, kbps: 2000, maiorLacunaMs: 100, erro: null };
  };

  const { saude } = await gerarSaude({
    canais,
    anterior,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
  });

  assert.ok(saude);
  // d preservado
  assert.equal(saude.canais["canal sem mudanca"].d, 1650000000);
  // d atualizado para agoraS
  assert.equal(saude.canais["canal mudou"].d, 1700000000);
  assert.equal(saude.canais["canal novo"].d, 1700000000);
  // Canal que sumiu da lista foi descartado
  assert.equal(saude.canais["canal que sumiu da lista"], undefined);
});

test("Nomes duplicados com estados diferentes (um vivo, um removido) → fora do arquivo", async () => {
  const canais = [
    { nome: "ESPN Extra HD", grupo: "Esportes", url: "http://h1.com/vivo" },
    { nome: "ESPN Extra HD", grupo: "Esportes", url: "http://h2.com/morto" },
    ...Array.from({ length: 8 }, (_, i) => ({
      nome: `Canal ${i}`,
      grupo: "Geral",
      url: `http://h1.com/${i}`,
    })),
  ];

  const fakeSondar = async (url) => {
    if (url.includes("/vivo")) {
      return { tipo: "ts", http: 200, bytes: 50000, kbps: 2000, maiorLacunaMs: 100, erro: null };
    }
    return { tipo: "vazio", http: 404, bytes: 0, kbps: 0, maiorLacunaMs: 0, erro: "http-404" };
  };

  const { saude } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
  });

  assert.ok(saude);
  assert.equal(saude.canais["espn extra hd"], undefined);
});

test("Duplicados com mesmo estado: desempate pelo d mais antigo", async () => {
  const canais = [
    { nome: "Band Sports HD", grupo: "Esportes", url: "http://h1.com/1" },
    { nome: "Band Sports HD", grupo: "Esportes", url: "http://h2.com/2" },
    ...Array.from({ length: 8 }, (_, i) => ({
      nome: `Canal ${i}`,
      grupo: "Geral",
      url: `http://h1.com/${i}`,
    })),
  ];

  const anterior = {
    v: 1,
    gerado: 1690000000,
    canais: {
      "band sports hd": { e: "removido", d: 1620000000, m: "http-404" },
    },
  };

  const fakeSondar = async () => ({
    tipo: "vazio",
    http: 404,
    bytes: 0,
    kbps: 0,
    maiorLacunaMs: 0,
    erro: "http-404",
  });

  const { saude } = await gerarSaude({
    canais,
    anterior,
    agoraS: 1700000000,
    sondarFn: fakeSondar,
  });

  assert.ok(saude);
  assert.equal(saude.canais["band sports hd"].d, 1620000000);
});

// --- Testes de integração via CLI ---

test("CLI: --out em pasta inexistente → código 1 com mensagem sem criar lixo", async () => {
  const tmpDir = path.join(os.tmpdir(), `teste-canais-${Date.now()}`);
  const outPath = path.join(tmpDir, "subpasta-inexistente", "saude.json");

  await assert.rejects(
    runCli(["--env-var", "MINHA_VAR", "--out", outPath], { MINHA_VAR: "http://dummy.url" }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr || err.stdout, /diretório|pasta|não existe/i);
      assert.equal(fs.existsSync(outPath), false);
      return true;
    }
  );
});

test("CLI: argumentos obrigatórios ausentes ou segredo vazio → código 1", async () => {
  // Sem --out
  await assert.rejects(
    runCli(["--env-var", "VAR_TESTE"], { VAR_TESTE: "http://dummy" }),
    (err) => {
      assert.equal(err.code, 1);
      return true;
    }
  );

  // Variável de ambiente vazia
  const tmpOut = path.join(os.tmpdir(), `saude-empty-${Date.now()}.json`);
  await assert.rejects(
    runCli(["--env-var", "VAR_VAZIA", "--out", tmpOut], { VAR_VAZIA: "" }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr || err.stdout, /vazia|não definida/i);
      return true;
    }
  );
});

test("CLI: lista vazia ou HTML no lugar de M3U → código 1 com mensagem clara", async () => {
  const tmpOut = path.join(os.tmpdir(), `saude-html-${Date.now()}.json`);

  await assert.rejects(
    runCli(["--env-var", "URL_LISTA", "--out", tmpOut], {
      URL_LISTA: `${serverBaseUrl}/parked`,
    }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr || err.stdout, /inválida|sem canais/i);
      assert.equal(fs.existsSync(tmpOut), false);
      return true;
    }
  );
});

test("CLI: lista pequena (<10 canais) → código 2, arquivo de saída não é tocado", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-pequena-"));
  const m3uPath = path.join(tmpDir, "lista.m3u");
  const outPath = path.join(tmpDir, "canais-saude.json");

  // Cria arquivo antigo para provar que fica intacto
  fs.writeFileSync(outPath, JSON.stringify({ antigo: true }));

  // Serve a lista de 3 canais
  const m3uContent = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Esportes", Canal 1',
    `${serverBaseUrl}/404`,
    '#EXTINF:-1 group-title="Esportes", Canal 2',
    `${serverBaseUrl}/404`,
    '#EXTINF:-1 group-title="Esportes", Canal 3',
    `${serverBaseUrl}/404`,
  ].join("\r\n");
  fs.writeFileSync(m3uPath, m3uContent);

  // Servidor simples de arquivo
  const fileServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => fileServer.listen(0, "127.0.0.1", res));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/lista.m3u`;

  try {
    await assert.rejects(
      runCli(["--env-var", "URL_PEQUENA", "--out", outPath], { URL_PEQUENA: fileUrl }),
      (err) => {
        assert.equal(err.code, 2);
        // Arquivo antigo permaneceu intacto
        const conteudo = JSON.parse(fs.readFileSync(outPath, "utf8"));
        assert.equal(conteudo.antigo, true);
        return true;
      }
    );
  } finally {
    fileServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: --anterior inexistente ou inválido é tratado como sem anterior", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-anterior-"));
  const outPath = path.join(tmpDir, "canais-saude.json");
  const anteriorInexistente = path.join(tmpDir, "nao-existe.json");

  const m3uContent = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Esportes", ESPN Teste',
    `${serverBaseUrl}/xui`,
    ...Array.from({ length: 9 }, (_, i) => [
      `#EXTINF:-1 group-title="Outros", Canal ${i}`,
      `${serverBaseUrl}/404`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/lista.m3u`;

  try {
    const { stdout } = await runCli(
      [
        "--env-var", "URL_LISTA",
        "--anterior", anteriorInexistente,
        "--out", outPath,
        "--agora", "1793600000",
      ],
      { URL_LISTA: urlLista }
    );

    assert.ok(fs.existsSync(outPath));
    const gerado = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(gerado.v, 1);
    assert.deepEqual(gerado.canais["espn teste"], {
      e: "removido",
      d: 1793600000,
      m: "xui-not_in_bouquet",
    });
    // Resumo emitido em uma linha
    assert.ok(stdout.trim().split("\n").length >= 1);
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: execução bem-sucedida, escrita atômica, indentação de 1 espaço e resumo só de números", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-ok-"));
  const outPath = path.join(tmpDir, "canais-saude.json");

  const m3uContent = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Esportes", Canal HLS Bom',
    `${serverBaseUrl}/hls/master.m3u8`,
    '#EXTINF:-1 group-title="Esportes", Canal 404',
    `${serverBaseUrl}/404`,
    ...Array.from({ length: 8 }, (_, i) => [
      `#EXTINF:-1 group-title="Outros", Canal Gen ${i}`,
      `${serverBaseUrl}/404`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/lista.m3u`;

  try {
    const { stdout } = await runCli(
      [
        "--env-var", "URL_LISTA",
        "--out", outPath,
        "--agora", "1793600000",
      ],
      { URL_LISTA: urlLista }
    );

    assert.ok(fs.existsSync(outPath));
    const textoJson = fs.readFileSync(outPath, "utf8");

    // Formatação: indentação com 1 espaço
    assert.ok(textoJson.includes('{\n "v": 1,'));

    const json = JSON.parse(textoJson);
    // Canal HLS Bom é vivo -> não entra
    assert.equal(json.canais["canal hls bom"], undefined);
    // Canal 404 entra
    assert.deepEqual(json.canais["canal 404"], {
      e: "removido",
      d: 1793600000,
      m: "http-404",
    });

    // O resumo impresso no stdout é um JSON em linha única
    const resumoLinha = stdout.trim().split("\n").pop();
    const resumo = JSON.parse(resumoLinha);
    assert.equal(typeof resumo.total, "number");
    assert.equal(typeof resumo.sondados, "number");
    assert.equal(typeof resumo.porEstado.removido, "number");
    assert.equal(typeof resumo.porEstado.instavel, "number");
    assert.equal(typeof resumo.porEstado.vivo, "number");
    assert.equal(typeof resumo.servidoresRemovidos, "number");
    assert.equal(typeof resumo.bloqueado, "boolean");
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Segredo: JSON de saída, resumo e console NUNCA contêm credenciais, hosts, IP ou portas", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-segredo-"));
  const outPath = path.join(tmpDir, "canais-saude.json");

  // Lista com credenciais e host sensíveis
  const usuario = "usuario123";
  const senha = "senha456";
  const hostComPorta = `127.0.0.1:${serverPort}`;

  const m3uContent = [
    "#EXTM3U",
    `#EXTINF:-1 group-title="Esportes", Canal Secreto`,
    `http://${hostComPorta}/live/${usuario}/${senha}/1.ts`,
    ...Array.from({ length: 9 }, (_, i) => [
      `#EXTINF:-1 group-title="Geral", Geral ${i}`,
      `http://${hostComPorta}/live/${usuario}/${senha}/${i + 2}.ts`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/live/${usuario}/${senha}/lista.m3u`;

  try {
    const { stdout, stderr } = await runCli(
      [
        "--env-var", "URL_SEGREDO",
        "--out", outPath,
      ],
      { URL_SEGREDO: urlLista }
    );

    const saidaConsole = (stdout || "") + (stderr || "");
    const conteudoJson = fs.readFileSync(outPath, "utf8");

    for (const texto of [saidaConsole, conteudoJson]) {
      assert.equal(texto.includes(usuario), false, `Vazou ${usuario}`);
      assert.equal(texto.includes(senha), false, `Vazou ${senha}`);
      assert.equal(texto.includes("127.0.0.1"), false, "Vazou 127.0.0.1");
      assert.equal(texto.includes("localhost"), false, "Vazou localhost");
      assert.equal(texto.includes(String(serverPort)), false, `Vazou porta ${serverPort}`);
      assert.equal(texto.includes(String(srv.address().port)), false, "Vazou porta srv");
    }
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Integração com sondar real: servidor local com parked, xui, hls e 503", async () => {
  const canais = [
    { nome: "Canal HLS", grupo: "Esportes", url: `${serverBaseUrl}/hls/master.m3u8` },
    { nome: "Canal XUI", grupo: "Esportes", url: `${serverBaseUrl}/xui` },
    { nome: "Canal Parked", grupo: "Esportes", url: `${serverBaseUrl}/parked` },
    { nome: "Canal 503", grupo: "Esportes", url: `${serverBaseUrl}/503` },
    ...Array.from({ length: 6 }, (_, i) => ({
      nome: `Canal Genérico ${i}`,
      grupo: "Outros",
      url: `${serverBaseUrl}/404`,
    })),
  ];

  const { saude, resumo } = await gerarSaude({
    canais,
    anterior: null,
    agoraS: 1793600000,
    config: {
      grupos: ["Esportes"],
      nomes: [],
      leituraMs: 2000,
      conexaoMs: 2000,
    },
  });

  assert.ok(saude);
  // HLS é vivo -> não entra no arquivo
  assert.equal(saude.canais["canal hls"], undefined);
  // XUI é removido
  assert.equal(saude.canais["canal xui"].e, "removido");
  assert.equal(saude.canais["canal xui"].m, "xui-not_in_bouquet");
  // Parked é removido
  assert.equal(saude.canais["canal parked"].e, "removido");
  assert.equal(saude.canais["canal parked"].m, "dominio-estacionado");
  // 503 é instável (nunca removido)
  assert.equal(saude.canais["canal 503"].e, "instavel");
  assert.equal(saude.canais["canal 503"].m, "http-503");
});

test("CLI: --anterior com JSON quebrado é tratado como sem anterior", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-corrompido-"));
  const outPath = path.join(tmpDir, "canais-saude.json");
  const anteriorCorrompido = path.join(tmpDir, "anterior-invalido.json");
  fs.writeFileSync(anteriorCorrompido, "{ json quebrado invalid ... ");

  const m3uContent = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Esportes", Canal Parked',
    `${serverBaseUrl}/parked`,
    ...Array.from({ length: 9 }, (_, i) => [
      `#EXTINF:-1 group-title="Outros", Canal ${i}`,
      `${serverBaseUrl}/404`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/lista.m3u`;

  try {
    await runCli(
      [
        "--env-var", "URL_LISTA",
        "--anterior", anteriorCorrompido,
        "--out", outPath,
        "--agora", "1793600000",
      ],
      { URL_LISTA: urlLista }
    );

    assert.ok(fs.existsSync(outPath));
    const gerado = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(gerado.canais["canal parked"].e, "removido");
    assert.equal(gerado.canais["canal parked"].d, 1793600000);
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: execução bloqueada (>90% erro de rede) sai com código 2 e arquivo antigo fica intacto", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-bloqueado-"));
  const outPath = path.join(tmpDir, "canais-saude.json");
  fs.writeFileSync(outPath, JSON.stringify({ intocado: true }));

  // Lista apontando para portas fechadas / inexistentes gerando erro de rede em 100% dos canais de esporte
  const portaFechada = 59999;
  const m3uContent = [
    "#EXTM3U",
    ...Array.from({ length: 10 }, (_, i) => [
      `#EXTINF:-1 group-title="Esportes", Esporte ${i}`,
      `http://127.0.0.1:${portaFechada}/${i}.ts`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/lista.m3u`;

  try {
    await assert.rejects(
      runCli(
        [
          "--env-var", "URL_LISTA",
          "--out", outPath,
        ],
        { URL_LISTA: urlLista }
      ),
      (err) => {
        assert.equal(err.code, 2);
        // Arquivo antigo permaneceu intacto
        const conteudo = JSON.parse(fs.readFileSync(outPath, "utf8"));
        assert.equal(conteudo.intocado, true);
        return true;
      }
    );
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: suporte a --env-file e --chave", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canais-envfile-"));
  const outPath = path.join(tmpDir, "canais-saude.json");
  const envFilePath = path.join(tmpDir, ".env.local");

  const m3uContent = [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Esportes", Canal Parked',
    `${serverBaseUrl}/parked`,
    ...Array.from({ length: 9 }, (_, i) => [
      `#EXTINF:-1 group-title="Outros", Canal ${i}`,
      `${serverBaseUrl}/404`,
    ]).flat(),
  ].join("\r\n");

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
    res.end(m3uContent);
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const urlLista = `http://127.0.0.1:${srv.address().port}/lista.m3u`;

  fs.writeFileSync(envFilePath, `URL_MINHA_LISTA="${urlLista}"\n`);

  try {
    await runCli([
      "--env-file", envFilePath,
      "--chave", "URL_MINHA_LISTA",
      "--out", outPath,
    ]);

    assert.ok(fs.existsSync(outPath));
    const gerado = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(gerado.canais["canal parked"].e, "removido");
  } finally {
    srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("saudeListaId: impressão digital da lista (mesmos valores no app web e na TV)", async () => {
  const { saudeListaId } = await import("../../scripts/canais-saude/build.mjs");
  assert.equal(saudeListaId("https://exemplo.test/lista.m3u?u=1"), "14eaa58a89e1ae");
  assert.equal(saudeListaId("  https://exemplo.test/lista.m3u?u=1  "), "14eaa58a89e1ae", "espaços nas pontas não contam");
  assert.equal(saudeListaId("x"), "0189af1820c6f5");
  assert.equal(saudeListaId(""), "");
  assert.equal(saudeListaId(null), "");
  assert.equal(saudeListaId(undefined), "");
  assert.equal(saudeListaId(42), "");
  assert.match(saudeListaId("qualquer coisa"), /^[0-9a-f]{14}$/);
});

test("gerarSaude: grava `lista` no JSON só quando a impressão digital é informada", async () => {
  const { gerarSaude } = await import("../../scripts/canais-saude/build.mjs");
  const canais = Array.from({ length: 12 }, (_, i) => ({ nome: "Canal " + i, grupo: "Esportes", url: "http://h1.test/c" + i }));
  const sondarFn = async () => ({ http: 200, saltos: 0, hostFinal: "h", ttfbMs: 5, bytes: 100000, kbps: 2000, paradas: 0, maiorLacunaMs: 10, tipo: "ts", erro: null });
  const cfg = { grupos: ["Esportes"], nomes: [], amostrasPorHost: 3, minCanaisPorHost: 6, leituraMs: 50, conexaoMs: 50, concorrencia: 2, maxFalhaPct: 90 };
  const com = await gerarSaude({ canais, anterior: null, agoraS: 1793600000, sondarFn, config: cfg, listaId: "14eaa58a89e1ae" });
  assert.equal(com.saude.lista, "14eaa58a89e1ae");
  assert.equal(com.saude.v, 1);
  const sem = await gerarSaude({ canais, anterior: null, agoraS: 1793600000, sondarFn, config: cfg });
  assert.equal("lista" in sem.saude, false);
});
