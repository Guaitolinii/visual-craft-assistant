import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";

const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "sintoniza-link.html"), "utf8");
const {
  faixasLer,
  faixasTemOpcoes,
  faixasEscolherAudio,
  faixasEscolherLegenda,
  faixasNomeIdioma,
} = loadVodHelpers();

test("faixasNomeIdioma: mapeamento de códigos e prefixos", () => {
  // Português (pt, por, pob)
  assert.equal(faixasNomeIdioma("pt"), "Português");
  assert.equal(faixasNomeIdioma("por"), "Português");
  assert.equal(faixasNomeIdioma("pob"), "Português");
  assert.equal(faixasNomeIdioma("pt-BR"), "Português");
  assert.equal(faixasNomeIdioma("PT_BR"), "Português");

  // Inglês (en, eng)
  assert.equal(faixasNomeIdioma("en"), "Inglês");
  assert.equal(faixasNomeIdioma("eng"), "Inglês");
  assert.equal(faixasNomeIdioma("en-US"), "Inglês");

  // Espanhol (es, spa)
  assert.equal(faixasNomeIdioma("es"), "Espanhol");
  assert.equal(faixasNomeIdioma("spa"), "Espanhol");

  // Francês (fr, fra, fre)
  assert.equal(faixasNomeIdioma("fr"), "Francês");
  assert.equal(faixasNomeIdioma("fra"), "Francês");
  assert.equal(faixasNomeIdioma("fre"), "Francês");

  // Alemão (de, deu, ger)
  assert.equal(faixasNomeIdioma("de"), "Alemão");
  assert.equal(faixasNomeIdioma("deu"), "Alemão");
  assert.equal(faixasNomeIdioma("ger"), "Alemão");

  // Italiano (it, ita)
  assert.equal(faixasNomeIdioma("it"), "Italiano");
  assert.equal(faixasNomeIdioma("ita"), "Italiano");

  // Japonês (ja, jpn)
  assert.equal(faixasNomeIdioma("ja"), "Japonês");
  assert.equal(faixasNomeIdioma("jpn"), "Japonês");

  // Coreano (ko, kor)
  assert.equal(faixasNomeIdioma("ko"), "Coreano");
  assert.equal(faixasNomeIdioma("kor"), "Coreano");

  // Chinês (zh, zho, chi)
  assert.equal(faixasNomeIdioma("zh"), "Chinês");
  assert.equal(faixasNomeIdioma("zho"), "Chinês");
  assert.equal(faixasNomeIdioma("chi"), "Chinês");

  // Desconhecidos, vazios e tipos inválidos
  assert.equal(faixasNomeIdioma("xyz"), "");
  assert.equal(faixasNomeIdioma(""), "");
  assert.equal(faixasNomeIdioma(null), "");
  assert.equal(faixasNomeIdioma(undefined), "");
  assert.equal(faixasNomeIdioma(123), "");
  assert.equal(faixasNomeIdioma({}), "");
});

test("faixasTemOpcoes: regras de contagem", () => {
  // 1 áudio e 0 legendas -> falso
  assert.equal(faixasTemOpcoes({ audio: [{ indice: 0 }], legendas: [] }), false);
  // 2 áudios e 0 legendas -> verdadeiro
  assert.equal(faixasTemOpcoes({ audio: [{ indice: 0 }, { indice: 1 }], legendas: [] }), true);
  // 0 áudios e 1 legenda -> verdadeiro
  assert.equal(faixasTemOpcoes({ audio: [], legendas: [{ indice: 0 }] }), true);
  // 1 áudio e 1 legenda -> verdadeiro
  assert.equal(faixasTemOpcoes({ audio: [{ indice: 0 }], legendas: [{ indice: 0 }] }), true);
  // entradas vazias/nulas
  assert.equal(faixasTemOpcoes(null), false);
  assert.equal(faixasTemOpcoes({}), false);
  assert.equal(faixasTemOpcoes({ audio: null, legendas: null }), false);
});

test("faixasLer: lida com video nulo ou sem listas sem lançar erro", () => {
  assert.deepEqual(faixasLer(null), { audio: [], legendas: [] });
  assert.deepEqual(faixasLer(undefined), { audio: [], legendas: [] });
  assert.deepEqual(faixasLer({}), { audio: [], legendas: [] });
  assert.deepEqual(faixasLer({ audioTracks: null, textTracks: null }), { audio: [], legendas: [] });
});

test("faixasLer: leitura e fallback de rótulos, índices, itens nulos e repetição", () => {
  const fakeVideo = {
    audioTracks: {
      0: { enabled: true, label: "Dublado", language: "pt" },
      1: null, // item nulo mantendo índice real
      2: { enabled: false, label: "", language: "en-US" },
      3: { enabled: false, label: "", language: "unknown-lang" },
      4: { enabled: false, label: "Dublado", language: "pt" }, // repetido
      5: { enabled: false, label: "Este é um rótulo extremamente longo com mais de quarenta caracteres com certeza", language: "pt" },
      6: { enabled: false, label: "Linha 1\nLinha 2\r\nLinha 3", language: "pt" },
      length: 7,
    },
    textTracks: {
      0: { kind: "subtitles", mode: "showing", label: "", language: "pt-BR" },
      1: { kind: "metadata", mode: "showing", label: "Ignorado", language: "pt" }, // deve ser ignorado
      2: { kind: "chapters", mode: "showing", label: "Ignorado 2", language: "pt" }, // deve ser ignorado
      3: { kind: "captions", mode: "disabled", label: "", language: "" }, // sem idioma -> Faixa 2
      4: { kind: "subtitles", mode: "disabled", label: "Português", language: "" }, // repetido com o primeiro
      length: 5,
    },
  };

  const res = faixasLer(fakeVideo);

  // Áudios
  assert.equal(res.audio.length, 6);
  assert.deepEqual(res.audio[0], { tipo: "audio", indice: 0, rotulo: "Dublado", ativa: true });
  assert.deepEqual(res.audio[1], { tipo: "audio", indice: 2, rotulo: "Inglês", ativa: false });
  assert.deepEqual(res.audio[2], { tipo: "audio", indice: 3, rotulo: "Faixa 3", ativa: false });
  assert.deepEqual(res.audio[3], { tipo: "audio", indice: 4, rotulo: "Dublado (2)", ativa: false });
  assert.equal(res.audio[4].rotulo.length <= 40, true);
  assert.equal(res.audio[4].rotulo, "Este é um rótulo extremamente longo com ");
  assert.equal(res.audio[5].rotulo, "Linha 1 Linha 2 Linha 3");

  // Legendas
  assert.equal(res.legendas.length, 3);
  assert.deepEqual(res.legendas[0], { tipo: "legenda", indice: 0, rotulo: "Português", ativa: true });
  assert.deepEqual(res.legendas[1], { tipo: "legenda", indice: 3, rotulo: "Faixa 2", ativa: false });
  assert.deepEqual(res.legendas[2], { tipo: "legenda", indice: 4, rotulo: "Português (2)", ativa: false });
});

test("faixasEscolherAudio: ativação, desativação de outras e tratamento de erro/índices inválidos", () => {
  const tracks = [
    { enabled: true },
    { enabled: false },
    { enabled: false },
  ];
  const fakeVideo = {
    audioTracks: {
      0: tracks[0],
      1: tracks[1],
      2: tracks[2],
      length: 3,
    },
  };

  // Escolhe a faixa 1
  assert.equal(faixasEscolherAudio(fakeVideo, 1), true);
  assert.equal(tracks[0].enabled, false);
  assert.equal(tracks[1].enabled, true);
  assert.equal(tracks[2].enabled, false);

  // Índices inválidos
  assert.equal(faixasEscolherAudio(fakeVideo, -1), false);
  assert.equal(faixasEscolherAudio(fakeVideo, 3), false);
  assert.equal(faixasEscolherAudio(fakeVideo, NaN), false);
  assert.equal(faixasEscolherAudio(fakeVideo, null), false);
  assert.equal(faixasEscolherAudio(null, 1), false);
  assert.equal(faixasEscolherAudio({}, 1), false);

  // Faixa null no índice
  const videoComNull = {
    audioTracks: {
      0: null,
      1: tracks[1],
      length: 2,
    },
  };
  assert.equal(faixasEscolherAudio(videoComNull, 0), false);

  // Setter que lança erro não derruba o fluxo
  let errorTrack = {
    get enabled() { return false; },
    set enabled(_) { throw new Error("setter falhou"); },
  };
  const videoComErro = {
    audioTracks: {
      0: errorTrack,
      1: tracks[1],
      length: 2,
    },
  };
  assert.doesNotThrow(() => {
    faixasEscolherAudio(videoComErro, 1);
  });
});

test("faixasEscolherLegenda: ligar, desligar todas (-1) e índices inválidos", () => {
  const tracks = [
    { kind: "subtitles", mode: "showing" },
    { kind: "captions", mode: "disabled" },
  ];
  const fakeVideo = {
    textTracks: {
      0: tracks[0],
      1: tracks[1],
      length: 2,
    },
  };

  // Desligar todas (-1)
  assert.equal(faixasEscolherLegenda(fakeVideo, -1), true);
  assert.equal(tracks[0].mode, "disabled");
  assert.equal(tracks[1].mode, "disabled");

  // Ligar a 1
  assert.equal(faixasEscolherLegenda(fakeVideo, 1), true);
  assert.equal(tracks[0].mode, "disabled");
  assert.equal(tracks[1].mode, "showing");

  // Índices inválidos
  assert.equal(faixasEscolherLegenda(fakeVideo, -2), false);
  assert.equal(faixasEscolherLegenda(fakeVideo, 2), false);
  assert.equal(faixasEscolherLegenda(fakeVideo, NaN), false);
  assert.equal(faixasEscolherLegenda(null, 0), false);
  assert.equal(faixasEscolherLegenda({}, 0), false);

  // Setter que lança não derruba
  const videoComErro = {
    textTracks: {
      0: {
        kind: "subtitles",
        get mode() { return "disabled"; },
        set mode(_) { throw new Error("falha mode"); },
      },
      length: 1,
    },
  };
  assert.doesNotThrow(() => {
    faixasEscolherLegenda(videoComErro, -1);
  });
});

test("HTML: elementos do botão e folha de faixas e ligações", () => {
  assert.ok(html.includes('id="faixas-btn"'), 'botão id="faixas-btn" existe no HTML');
  assert.ok(html.includes('id="faixas-sheet"'), 'folha id="faixas-sheet" existe no HTML');
  assert.ok(html.includes('id="faixas-sheet-cancel"'), 'botão id="faixas-sheet-cancel" existe no HTML');
  assert.ok(html.includes('data-lucide="languages"'), 'ícone languages no botão');
  assert.ok(html.includes("fecharFaixasSheet"), "fecharFaixasSheet existe");

  // selectChannel e playVodSelection fecham a folha ou escondem o botão
  const selectChIdx = html.indexOf("function selectChannel(");
  assert.ok(selectChIdx !== -1, "selectChannel existe");
  const selectChBody = html.slice(selectChIdx, selectChIdx + 500);
  assert.ok(selectChBody.includes("fecharFaixasSheet();"), "selectChannel fecha a folha de faixas");

  const playVodIdx = html.indexOf("function playVodSelection(");
  assert.ok(playVodIdx !== -1, "playVodSelection existe");
  const playVodBody = html.slice(playVodIdx, playVodIdx + 500);
  assert.ok(playVodBody.includes("fecharFaixasSheet();"), "playVodSelection fecha a folha de faixas");
});
