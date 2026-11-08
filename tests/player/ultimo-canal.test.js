import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("abrirUltimoAtivo: leitura de preferências com fallback seguro", () => {
  const { abrirUltimoAtivo } = loadVodHelpers();

  // Desligada por padrão: null, undefined, sem storage ou que lança -> false
  assert.equal(abrirUltimoAtivo(null), false);
  assert.equal(abrirUltimoAtivo(undefined), false);
  assert.equal(abrirUltimoAtivo({ getItem: () => null }), false);
  assert.equal(abrirUltimoAtivo({ getItem: () => "0" }), false);
  assert.equal(abrirUltimoAtivo({ getItem: () => "qualquer" }), false);
  assert.equal(abrirUltimoAtivo({ getItem: () => { throw new Error("Storage indisponível"); } }), false);

  // Apenas true quando getItem devolver "1"
  assert.equal(abrirUltimoAtivo({ getItem: (k) => (k === "sintoniza_pref_abrir_ultimo" ? "1" : null) }), true);
  assert.equal(abrirUltimoAtivo({ getItem: () => "1" }), true);
});

test("ultimoCanalParaAbrir: entradas inválidas devolvem null", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();

  assert.equal(ultimoCanalParaAbrir(null, []), null);
  assert.equal(ultimoCanalParaAbrir(undefined, []), null);
  assert.equal(ultimoCanalParaAbrir({}, []), null);
  assert.equal(ultimoCanalParaAbrir("recents", []), null);
  assert.equal(ultimoCanalParaAbrir([], null), null);
  assert.equal(ultimoCanalParaAbrir([], undefined), null);
  assert.equal(ultimoCanalParaAbrir([], {}), null);
  assert.equal(ultimoCanalParaAbrir([], "channels"), null);

  // Itens inválidos ou nulos dentro de recents
  assert.equal(ultimoCanalParaAbrir([null, undefined, {}, { id: null }], [{ id: "1", url: "http://ch1" }]), null);
});

test("ultimoCanalParaAbrir: perfil sem recentes devolve null", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();
  const channels = [{ id: "1", name: "Canal 1", url: "http://ch1" }];
  assert.equal(ultimoCanalParaAbrir([], channels), null);
});

test("ultimoCanalParaAbrir: casa primeiro canal existente com url", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();
  const channels = [
    { id: "10", name: "Canal 10", url: "http://stream10" },
    { id: "20", name: "Canal 20", url: "http://stream20" }
  ];
  const recents = [
    { id: "20", type: "channel", ts: 200 },
    { id: "10", type: "channel", ts: 100 }
  ];

  const achado = ultimoCanalParaAbrir(recents, channels);
  assert.deepEqual(achado, channels[1]);
});

test("ultimoCanalParaAbrir: ignora type diferente de channel", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();
  const channels = [{ id: "10", name: "Canal 10", url: "http://stream10" }];
  const recents = [
    { id: "10", type: "movie", ts: 200 },
    { id: "10", type: "series", ts: 150 },
    { id: "10", type: undefined, ts: 100 }
  ];

  assert.equal(ultimoCanalParaAbrir(recents, channels), null);
});

test("ultimoCanalParaAbrir: comparação de id numérico x texto", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();

  // recents com número 5 e channels com string "5"
  const channelsStr = [{ id: "5", name: "Canal 5", url: "http://stream5" }];
  const recentsNum = [{ id: 5, type: "channel", ts: 100 }];
  assert.deepEqual(ultimoCanalParaAbrir(recentsNum, channelsStr), channelsStr[0]);

  // recents com string "5" e channels com número 5
  const channelsNum = [{ id: 5, name: "Canal 5", url: "http://stream5" }];
  const recentsStr = [{ id: "5", type: "channel", ts: 100 }];
  assert.deepEqual(ultimoCanalParaAbrir(recentsStr, channelsNum), channelsNum[0]);
});

test("ultimoCanalParaAbrir: recente mais novo ausente ou sem url cai para o próximo válido", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();
  const channels = [
    { id: "1", name: "Canal sem URL", url: "" },
    { id: "2", name: "Canal Válido", url: "http://stream2" }
  ];
  const recents = [
    { id: "999", type: "channel", ts: 300 }, // não existe na lista
    { id: "1", type: "channel", ts: 200 },   // existe mas não tem url válida
    { id: "2", type: "channel", ts: 100 }    // existe e tem url
  ];

  const achado = ultimoCanalParaAbrir(recents, channels);
  assert.deepEqual(achado, channels[1]);
});

test("ultimoCanalParaAbrir: nenhum recente válido devolve null", () => {
  const { ultimoCanalParaAbrir } = loadVodHelpers();
  const channels = [{ id: "1", name: "Canal 1", url: "http://stream1" }];
  const recents = [
    { id: "2", type: "channel", ts: 200 },
    { id: "3", type: "channel", ts: 100 }
  ];

  assert.equal(ultimoCanalParaAbrir(recents, channels), null);
});

test("HTML contém a marcação e elementos da especificação W3", () => {
  assert.ok(html.includes('id="pref-last-channel"'), 'deve conter id="pref-last-channel"');
  assert.ok(html.includes("sintoniza_pref_abrir_ultimo"), 'deve conter a chave "sintoniza_pref_abrir_ultimo"');
  assert.ok(html.includes("Abrir no último canal ao iniciar"), 'deve conter o texto "Abrir no último canal ao iniciar"');

  // Duas chamadas a tentarAbrirUltimoCanal(0) (em loadPlaylistFromUrl e loadPlaylistFromFile)
  const matches = html.match(/tentarAbrirUltimoCanal\(0\)/g) || [];
  assert.equal(matches.length, 2, "deve chamar tentarAbrirUltimoCanal(0) exatamente duas vezes");
});
