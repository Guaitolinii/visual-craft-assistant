import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gerarJogos, main } from "../../scripts/jogos/build.mjs";
import { carregarRegras } from "../../scripts/jogos/regras.mjs";
import { ESPN_LALIGA, ESPN_NFL, EPG_AMOSTRA, GE_HTML } from "./fixtures.js";

const AGORA = Date.parse("2026-10-25T18:00:00-03:00") / 1000;
const ALIASES = JSON.parse(readFileSync(new URL("../../scripts/jogos/aliases-times.json", import.meta.url), "utf8"));
const regras = carregarRegras();

// fetch de mentira: ESPN devolve a fixture certa por competição; o ge devolve a página de teste
function fetchFalso({ espnOk = true, geOk = true, chamadas = [] } = {}) {
  return async (url) => {
    chamadas.push(url);
    if (url.startsWith("https://ge.globo.com/agenda")) {
      if (!geOk) return { ok: false, status: 503, text: async () => "" };
      return { ok: true, status: 200, text: async () => GE_HTML };
    }
    if (!espnOk) return { ok: false, status: 500, json: async () => ({}) };
    if (url.includes("/soccer/esp.1/") && url.includes("dates=20261026")) return { ok: true, json: async () => ESPN_LALIGA };
    if (url.includes("/football/nfl/") && url.includes("dates=20261026")) return { ok: true, json: async () => ESPN_NFL };
    return { ok: true, json: async () => ({ events: [] }) };
  };
}

test("gerarJogos: junta as três fontes e devolve o arquivo no formato publicado", async () => {
  const avisos = [];
  const { arquivo, resumo } = await gerarJogos({ agoraSec: AGORA, regras, aliases: ALIASES, epg: EPG_AMOSTRA, fetchFn: fetchFalso(), avisar: (m) => avisos.push(m) });
  assert.equal(arquivo.v, 1);
  assert.equal(arquivo.gerado, AGORA);
  assert.equal(arquivo.fuso, "America/Sao_Paulo");
  const por = (esp) => arquivo.jogos.filter((j) => j.esporte === esp);
  // LaLiga: a ESPN traz o jogo e o guia confirma a ESPN
  const laliga = arquivo.jogos.find((j) => j.id === "espn-401882828");
  assert.deepEqual(laliga.canais, ["espn"]);
  // NFL: a ESPN traz o jogo e o guia confirma ESPN 2 e ESPN 3
  const nfl = arquivo.jogos.find((j) => j.id === "espn-401873009");
  assert.deepEqual(nfl.canais, ["espn 2", "espn 3"]);
  // NBA e College Football só existem no guia: entram assim mesmo
  assert.equal(por("nba").length, 1);
  assert.equal(por("ncaaf").length, 1);
  // ge: o jogo do Brasileirão entra com os prováveis da Premiere
  const coritiba = arquivo.jogos.find((j) => j.casa && j.casa.nome === "Coritiba");
  assert.deepEqual(coritiba.provaveis, regras.marcas.premiere);
  assert.ok(resumo.espn.jogos >= 2 && resumo.ge.jogos === 2 && resumo.guia.jogos >= 5);
  assert.equal(avisos.length, 0);
});

test("gerarJogos: se o ge cair, avisa e segue com as outras fontes", async () => {
  const avisos = [];
  const { arquivo } = await gerarJogos({ agoraSec: AGORA, regras, aliases: ALIASES, epg: EPG_AMOSTRA, fetchFn: fetchFalso({ geOk: false }), avisar: (m) => avisos.push(m) });
  assert.ok(arquivo.jogos.length >= 3);
  assert.ok(avisos.some((m) => /ge/i.test(m)));
});

test("gerarJogos: fontes.ge desligada não chama o ge", async () => {
  const chamadas = [];
  const semGe = { ...regras, fontes: { ...regras.fontes, ge: false } };
  await gerarJogos({ agoraSec: AGORA, regras: semGe, aliases: ALIASES, epg: EPG_AMOSTRA, fetchFn: fetchFalso({ chamadas }), avisar: () => {} });
  assert.equal(chamadas.some((u) => u.includes("ge.globo.com")), false);
});

test("gerarJogos: faz 108 consultas à ESPN (27 competições x véspera, hoje, amanhã e depois de amanhã)", async () => {
  const chamadas = [];
  await gerarJogos({ agoraSec: AGORA, regras, aliases: ALIASES, epg: EPG_AMOSTRA, fetchFn: fetchFalso({ chamadas }), avisar: () => {} });
  const espn = chamadas.filter((u) => u.includes("espn.com"));
  assert.equal(espn.length, 108);
  for (const dia of ["20261024", "20261025", "20261026", "20261027"]) assert.ok(espn.some((u) => u.includes(`dates=${dia}`)), dia);
  assert.equal(espn.some((u) => u.includes("dates=20261028")), false);
});

test("gerarJogos: sem nenhuma fonte produzindo jogos, falha (para não publicar arquivo vazio)", async () => {
  await assert.rejects(
    gerarJogos({ agoraSec: AGORA, regras, aliases: ALIASES, epg: null, fetchFn: fetchFalso({ espnOk: false, geOk: false }), avisar: () => {} }),
    /nenhuma fonte/,
  );
});

test("main: grava o arquivo no sucesso e NÃO grava nada na falha (o arquivo bom anterior fica)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jogos-"));
  const epgPath = path.join(dir, "epg-extra.json");
  const outPath = path.join(dir, "jogos.json");
  writeFileSync(epgPath, JSON.stringify(EPG_AMOSTRA));
  const log = [];
  const ok = await main(["--epg", epgPath, "--out", outPath], { fetchFn: fetchFalso(), agoraSec: AGORA, log: (m) => log.push(m) });
  assert.equal(ok, 0);
  const gravado = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(gravado.v, 1);
  assert.ok(gravado.jogos.length >= 3);

  const dir2 = mkdtempSync(path.join(tmpdir(), "jogos-"));
  const out2 = path.join(dir2, "jogos.json");
  const falha = await main(["--epg", path.join(dir2, "nao-existe.json"), "--out", out2], { fetchFn: fetchFalso({ espnOk: false, geOk: false }), agoraSec: AGORA, log: () => {} });
  assert.equal(falha, 1);
  assert.equal(existsSync(out2), false);
});

test("F1: se as fontes só trouxerem jogos fora da janela, falha e NÃO sobrescreve arquivo bom existente", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jogos-f1-"));
  const epgPath = path.join(dir, "epg-velho.json");
  const outPath = path.join(dir, "jogos.json");
  // Guia com um jogo de 20/10/2026 (fora da janela de 25/10/2026)
  const inicioVelho = Date.parse("2026-10-20T19:00:00-03:00") / 1000;
  const epgVelho = { canais: { "sportv": [[inicioVelho, inicioVelho + 7200, "Flamengo x Vasco", ""]] } };
  writeFileSync(epgPath, JSON.stringify(epgVelho));
  writeFileSync(outPath, JSON.stringify({ bom: 1 }));

  const falha = await main(["--epg", epgPath, "--out", outPath], {
    fetchFn: fetchFalso({ espnOk: false, geOk: false }),
    agoraSec: AGORA,
    log: () => {},
  });

  assert.equal(falha, 1);
  const mantido = JSON.parse(readFileSync(outPath, "utf8"));
  assert.deepEqual(mantido, { bom: 1 });
});
