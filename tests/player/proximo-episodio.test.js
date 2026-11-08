import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("proximoEpisodioDe: próximo na mesma temporada", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: 1, title: "Ep 1", container_extension: "mp4" },
    { id: "102", season: 1, episode_num: 2, title: "Ep 2", container_extension: "mp4" },
    { id: "103", season: 1, episode_num: 3, title: "Ep 3", container_extension: "mp4" },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "101", season: 1, episode: 1 });
  assert.equal(prox?.id, "102");
});

test("proximoEpisodioDe: virada para a temporada seguinte", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: 1, title: "S1E1" },
    { id: "102", season: 1, episode_num: 2, title: "S1E2" },
    { id: "201", season: 2, episode_num: 1, title: "S2E1" },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "102", season: 1, episode: 2 });
  assert.equal(prox?.id, "201");
});

test("proximoEpisodioDe: último da série devolve null", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: 1 },
    { id: "201", season: 2, episode_num: 1 },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "201", season: 2, episode: 1 });
  assert.equal(prox, null);
});

test("proximoEpisodioDe: especiais (temporada <= 0) não puxam a temporada 1", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "001", season: 0, episode_num: 1 },
    { id: "002", season: 0, episode_num: 2 },
    { id: "101", season: 1, episode_num: 1 },
  ];
  // No último especial (season 0) não deve puxar season 1
  const proxFimEspecial = proximoEpisodioDe(episodes, { id: "002", season: 0, episode: 2 });
  assert.equal(proxFimEspecial, null);

  // Mas dentro dos especiais, ainda avança para o próximo especial
  const proxDentroEspecial = proximoEpisodioDe(episodes, { id: "001", season: 0, episode: 1 });
  assert.equal(proxDentroEspecial?.id, "002");
});

test("proximoEpisodioDe: achar por id quando episode_num está sujo", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: "dirty-1" },
    { id: "102", season: 1, episode_num: 2 },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "101", season: 1, episode: 999 });
  assert.equal(prox?.id, "102");
});

test("proximoEpisodioDe: achar por temporada+episódio quando o id não bate", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: 1 },
    { id: "102", season: 1, episode_num: 2 },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "outro_id", season: 1, episode: 1 });
  assert.equal(prox?.id, "102");
});

test("proximoEpisodioDe: ordem embaralhada é ordenada por temporada e depois episódio", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "202", season: 2, episode_num: 2 },
    { id: "102", season: 1, episode_num: 2 },
    { id: "101", season: 1, episode_num: 1 },
    { id: "201", season: 2, episode_num: 1 },
  ];
  const prox1 = proximoEpisodioDe(episodes, { id: "101", season: 1, episode: 1 });
  assert.equal(prox1?.id, "102");
  const prox2 = proximoEpisodioDe(episodes, { id: "102", season: 1, episode: 2 });
  assert.equal(prox2?.id, "201");
});

test("proximoEpisodioDe: empate mantém a ordem original do provedor", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101a", season: 1, episode_num: 1 },
    { id: "101b", season: 1, episode_num: 1 },
    { id: "102", season: 1, episode_num: 2 },
  ];
  const proxA = proximoEpisodioDe(episodes, { id: "101a", season: 1, episode: 1 });
  assert.equal(proxA?.id, "101b");
});

test("proximoEpisodioDe: episódio sem id é pulado/ignorado", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  const episodes = [
    { id: "101", season: 1, episode_num: 1 },
    { id: null, season: 1, episode_num: 2 },
    { id: "", season: 1, episode_num: 3 },
    { season: 1, episode_num: 4 },
    { id: "105", season: 1, episode_num: 5 },
  ];
  const prox = proximoEpisodioDe(episodes, { id: "101", season: 1, episode: 1 });
  assert.equal(prox?.id, "105");
});

test("proximoEpisodioDe: entradas inválidas devolvem null", () => {
  const { proximoEpisodioDe } = loadVodHelpers();
  assert.equal(proximoEpisodioDe(null, { id: "101", season: 1, episode: 1 }), null);
  assert.equal(proximoEpisodioDe("não-array", { id: "101", season: 1, episode: 1 }), null);
  assert.equal(proximoEpisodioDe([], { id: "101", season: 1, episode: 1 }), null);
  assert.equal(proximoEpisodioDe(undefined, { id: "101", season: 1, episode: 1 }), null);

  const episodes = [
    null,
    undefined,
    { season: "invalid", episode_num: "nan" },
    { id: "101", season: "1", episode_num: "1" },
    { id: "102", season: 1, episode_num: 2 },
  ];
  // Item sem id / null dentro da lista ignorado
  assert.equal(proximoEpisodioDe(episodes, { id: "101", season: 1, episode: 1 })?.id, "102");

  // Atual sem número e sem id achado -> null
  assert.equal(proximoEpisodioDe(episodes, { id: "inexistente", season: NaN, episode: NaN }), null);
  assert.equal(proximoEpisodioDe(episodes, null), null);
  assert.equal(proximoEpisodioDe(episodes, {}), null);
});

test("proximoEpSegundos: cálculo e entradas inválidas", () => {
  const { proximoEpSegundos } = loadVodHelpers();
  assert.equal(proximoEpSegundos(10000, 0), 10);
  assert.equal(proximoEpSegundos(10000, 999), 10); // 9001 ms -> 10 s (arredonda para cima)
  assert.equal(proximoEpSegundos(10000, 1000), 9);
  assert.equal(proximoEpSegundos(10000, 9999), 1);
  assert.equal(proximoEpSegundos(10000, 10000), 0);
  assert.equal(proximoEpSegundos(10000, 11000), 0); // agora > fim -> 0
  assert.equal(proximoEpSegundos(NaN, 1000), 0);
  assert.equal(proximoEpSegundos(10000, NaN), 0);
  assert.equal(proximoEpSegundos(undefined, 0), 0);
  assert.equal(proximoEpSegundos(0, 0), 0);
  assert.equal(proximoEpSegundos(-1000, 0), 0);
});

test("proximoEpAtivo: leitura de preferências com fallback seguro", () => {
  const { proximoEpAtivo } = loadVodHelpers();
  // padrão true
  assert.equal(proximoEpAtivo(null), true);
  assert.equal(proximoEpAtivo(undefined), true);
  assert.equal(proximoEpAtivo({ getItem: () => null }), true);
  assert.equal(proximoEpAtivo({ getItem: () => "1" }), true);
  assert.equal(proximoEpAtivo({ getItem: () => "qualquer" }), true);
  assert.equal(proximoEpAtivo({ getItem: () => { throw new Error("Storage indisponível"); } }), true);

  // false apenas se "0"
  assert.equal(proximoEpAtivo({ getItem: (k) => (k === "sintoniza_pref_proximo_ep" ? "0" : null) }), false);
});

test("HTML contém a marcação e elementos da especificação", () => {
  assert.ok(html.includes('id="proximo-ep-card"'), 'deve conter id="proximo-ep-card"');
  assert.ok(html.includes('id="pref-next-ep"'), 'deve conter id="pref-next-ep"');
  assert.ok(html.includes("sintoniza_pref_proximo_ep"), 'deve conter a chave "sintoniza_pref_proximo_ep"');
});
