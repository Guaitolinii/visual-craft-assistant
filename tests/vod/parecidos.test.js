import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVodHelpers } from "./loadVodHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const html = readFileSync(LINK_HTML_PATH, "utf8");

test("HTML possui elementos necessários e chamada de renderTitulosParecidos", () => {
  assert.ok(html.includes('id="vod-modal-similar"'), "id='vod-modal-similar' deve existir no HTML");
  assert.ok(html.includes('id="vod-modal-similar-row"'), "id='vod-modal-similar-row' deve existir no HTML");
  assert.ok(html.includes("renderTitulosParecidos("), "chamada renderTitulosParecidos deve existir no script");
  
  // Confirma que vod-modal-similar está depois de vod-modal-series-content dentro de vod-modal-body
  const seriesContentPos = html.indexOf('id="vod-modal-series-content"');
  const similarPos = html.indexOf('id="vod-modal-similar"');
  const bodyClosePos = html.indexOf('</div>', similarPos);
  assert.ok(seriesContentPos > 0, "vod-modal-series-content deve existir");
  assert.ok(similarPos > seriesContentPos, "vod-modal-similar deve vir depois de vod-modal-series-content");
});

test("parecidosDe: mesmo grupo entra e outro grupo não (corte em 3 pontos)", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "1", titulo: "Filme A", grupo: "Ação", ano: 2020, nota: 6.0, capa: "capa1.jpg" };
  const candidatos = [
    { id: "2", titulo: "Filme B", grupo: "Ação", ano: 2020, nota: 6.0, capa: "capa2.jpg" }, // mesmo grupo (+3) -> 3 pts -> entra
    { id: "3", titulo: "Filme C", grupo: "Drama", ano: 2020, nota: 6.0, capa: "capa3.jpg" }, // grupo diferente, ano igual (+1) -> 1 pt -> fora
  ];
  const res = parecidosDe(base, candidatos);
  assert.deepEqual(res, ["2"]);
});

test("parecidosDe: gênero em comum em grupos compostos ('Ação | Aventura')", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "1", titulo: "Filme A", grupo: "Ação | Aventura", ano: 2010, nota: 6.0, capa: "capa1.jpg" };
  const candidatos = [
    // base tem partes: "acao", "aventura".
    // cand1: grupo "Comédia | Aventura" -> grupos diferentes, mas tem "aventura" em comum (+2) + mesmo ano (+1) -> 3 pts -> entra
    { id: "2", titulo: "Filme B", grupo: "Comédia | Aventura", ano: 2010, nota: 6.0, capa: "capa2.jpg" },
    // cand2: grupo "Romance / Suspense" -> 0 partes em comum + mesmo ano (+1) + nota 8 (+0.5) = 1.5 pts -> fora (< 3)
    { id: "3", titulo: "Filme C", grupo: "Romance / Suspense", ano: 2010, nota: 8.0, capa: "capa3.jpg" },
  ];
  const res = parecidosDe(base, candidatos);
  assert.deepEqual(res, ["2"]);
});

test("parecidosDe: separadores de gênero (, / | ·) e partes de 1-2 letras ignoradas", () => {
  const { parecidosDe } = loadVodHelpers();
  // Partes com 1 ou 2 letras como '3D', '4K', 'HD', 'TV' devem ser ignoradas
  const base = { id: "1", titulo: "Base", grupo: "HD · 3D / Ação, Suspense", ano: 2020, nota: 5, capa: "c1.jpg" };
  const cand = { id: "2", titulo: "Outro", grupo: "4K | HD · Suspense", ano: 2020, nota: 5, capa: "c2.jpg" };
  // "HD" tem 2 letras -> ignorado. "Suspense" tem >= 3 letras -> +2 pontos. Ano 2020 == 2020 -> +1 ponto. Total = 3 pontos -> entra.
  assert.deepEqual(parecidosDe(base, [cand]), ["2"]);

  // Se só tiver "HD" em comum e ano próximo: 0 + 1 = 1 ponto -> fora
  const candSoHd = { id: "3", titulo: "Outro 2", grupo: "4K | HD", ano: 2020, nota: 5, capa: "c3.jpg" };
  assert.deepEqual(parecidosDe(base, [candSoHd]), []);
});

test("parecidosDe: ordenação por pontos (desc), depois nota (desc), depois ano (desc), depois ordem original", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "10", titulo: "Base", grupo: "Ação", ano: 2020, nota: 7.0, capa: "base.jpg" };
  const candidatos = [
    // cand1: mesmo grupo (+3), ano 2020 (+1), nota 8 (+0.5) = 4.5 pts
    { id: "1", titulo: "Cand 1", grupo: "Ação", ano: 2020, nota: 8.0, capa: "c.jpg" },
    // cand2: mesmo grupo (+3), ano 2020 (+1), nota 6 = 4.0 pts, ano 2020
    { id: "2", titulo: "Cand 2", grupo: "Ação", ano: 2020, nota: 6.0, capa: "c.jpg" },
    // cand3: mesmo grupo (+3), ano 2021 (+1), nota 8 (+0.5) = 4.5 pts (mesmos pontos que cand1, mesma nota 8, mas ano 2021 > ano 2020!)
    { id: "3", titulo: "Cand 3", grupo: "Ação", ano: 2021, nota: 8.0, capa: "c.jpg" },
    // cand4: mesmo grupo (+3), ano 2020 (+1), nota 6 = 4.0 pts, ano 2020 (empate total com cand2 -> mantém ordem após cand2)
    { id: "4", titulo: "Cand 4", grupo: "Ação", ano: 2020, nota: 6.0, capa: "c.jpg" },
  ];
  // cand3 e cand1 têm 4.5 pts e nota 8. cand3 tem ano 2021 > cand1 ano 2020 -> cand3 vem primeiro!
  // cand2 e cand4 têm 4.0 pts, nota 6, ano 2020 -> cand2 antes de cand4 pela ordem original.
  const res = parecidosDe(base, candidatos);
  assert.deepEqual(res, ["3", "1", "2", "4"]);
});

test("parecidosDe: exclui o próprio título (por id e por título com ano entre parênteses)", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "1", titulo: "Matrix (1999)", grupo: "Ação", ano: 1999, nota: 8.5, capa: "c1.jpg" };
  const candidatos = [
    { id: "1", titulo: "Matrix Outro Nome", grupo: "Ação", ano: 1999, nota: 8.5, capa: "c.jpg" }, // mesmo id
    { id: "2", titulo: "matrix", grupo: "Ação", ano: 1999, nota: 8.5, capa: "c.jpg" }, // mesmo título sem ano
    { id: "3", titulo: "Matrix (1999) ", grupo: "Ação", ano: 1999, nota: 8.5, capa: "c.jpg" }, // mesmo título normalizado
    { id: "4", titulo: "Matrix Reloaded", grupo: "Ação", ano: 2003, nota: 7.2, capa: "c.jpg" }, // título diferente -> entra!
  ];
  const res = parecidosDe(base, candidatos);
  assert.deepEqual(res, ["4"]);
});

test("parecidosDe: deduplica candidatos por título normalizado (fica o primeiro)", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "0", titulo: "Base", grupo: "Ação", ano: 2020, nota: 7, capa: "c0.jpg" };
  const candidatos = [
    { id: "1", titulo: "Homem-Aranha (2002)", grupo: "Ação", ano: 2002, nota: 8.0, capa: "c1.jpg" },
    { id: "2", titulo: "Homem Aranha", grupo: "Ação", ano: 2002, nota: 9.0, capa: "c2.jpg" }, // duplica o primeiro
    { id: "3", titulo: "Batman", grupo: "Ação", ano: 2008, nota: 9.0, capa: "c3.jpg" },
  ];
  const res = parecidosDe(base, candidatos);
  // Homem Aranha duplicado fica o primeiro (id 1).
  // Pontos de cand 1 e 2: Ação (+3) = 3 pts. Batman: Ação (+3) = 3 pts.
  // cand1 nota 8, Batman nota 9. Batman tem nota maior, fica na frente.
  assert.deepEqual(res, ["3", "1"]);
});

test("parecidosDe: corta em 12 por padrão ou no limite especificado", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "0", titulo: "Base", grupo: "Ação", ano: 2020, nota: 7, capa: "c0.jpg" };
  const candidatos = [];
  for (let i = 1; i <= 20; i++) {
    candidatos.push({ id: String(i), titulo: `Filme ${i}`, grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" });
  }
  const padrao = parecidosDe(base, candidatos);
  assert.equal(padrao.length, 12);

  const limite5 = parecidosDe(base, candidatos, 5);
  assert.equal(limite5.length, 5);
});

test("parecidosDe: sem capa ou sem título é ignorado", () => {
  const { parecidosDe } = loadVodHelpers();
  const base = { id: "0", titulo: "Base", grupo: "Ação", ano: 2020, nota: 7, capa: "c0.jpg" };
  const candidatos = [
    { id: "1", titulo: "Sem Capa", grupo: "Ação", ano: 2020, nota: 7, capa: "" },
    { id: "2", titulo: "", grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" },
    { id: "3", titulo: null, grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" },
    { id: "4", titulo: "Válido", grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" },
  ];
  assert.deepEqual(parecidosDe(base, candidatos), ["4"]);
});

test("parecidosDe: entradas inválidas não lançam erro", () => {
  const { parecidosDe } = loadVodHelpers();
  // base null ou sem id -> []
  assert.deepEqual(parecidosDe(null, [{ id: "1", titulo: "A", grupo: "G", capa: "c" }]), []);
  assert.deepEqual(parecidosDe({}, [{ id: "1", titulo: "A", grupo: "G", capa: "c" }]), []);
  assert.deepEqual(parecidosDe({ id: "" }, [{ id: "1", titulo: "A", grupo: "G", capa: "c" }]), []);

  // candidatos null ou não-array -> []
  assert.deepEqual(parecidosDe({ id: "1", titulo: "A" }, null), []);
  assert.deepEqual(parecidosDe({ id: "1", titulo: "A" }, {}), []);

  // limite 0 explícito -> []
  const base = { id: "0", titulo: "Base", grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" };
  const cand = [{ id: "1", titulo: "Válido", grupo: "Ação", ano: 2020, nota: 7, capa: "c.jpg" }];
  assert.deepEqual(parecidosDe(base, cand, 0), []);

  // limite negativo ou NaN -> usa 12
  assert.equal(parecidosDe(base, cand, -1).length, 1);
  assert.equal(parecidosDe(base, cand, NaN).length, 1);

  // candidato null na lista é ignorado
  assert.deepEqual(parecidosDe(base, [null, cand[0]]), ["1"]);

  // grupo vazio nos dois lados não soma ponto de grupo
  const semGrupoBase = { id: "0", titulo: "Base", grupo: "", ano: 2020, nota: 7, capa: "c.jpg" };
  const semGrupoCand = [{ id: "1", titulo: "Cand", grupo: "", ano: 2020, nota: 7, capa: "c.jpg" }];
  // ano (+1) + nota>=7 (+0.5) = 1.5 pts (< 3) -> []
  assert.deepEqual(parecidosDe(semGrupoBase, semGrupoCand), []);

  // ano 0 não soma ponto de época
  const anoZeroBase = { id: "0", titulo: "Base", grupo: "Ação", ano: 0, nota: 6, capa: "c.jpg" };
  const anoZeroCand = [{ id: "1", titulo: "Cand", grupo: "Outro", ano: 0, nota: 6, capa: "c.jpg" }];
  assert.deepEqual(parecidosDe(anoZeroBase, anoZeroCand), []);
});

test("vodParecidoNormalizar: resolução por categories, genre, category_name e limpeza de prefixo 'XXX | '", () => {
  const { vodParecidoNormalizar } = loadVodHelpers();
  const categories = [
    { category_id: "10", category_name: "Filmes | Ficção Científica" },
    { category_id: "20", category_name: "Series | Suspense e Terror" },
  ];

  // 1. Resolução pelo category_id batendo com categories, removendo prefixo "XXX | "
  const item1 = { stream_id: 101, name: "Interestelar (2014)", category_id: "10", releaseDate: "2014-11-07", rating: "8.6", stream_icon: "https://img/101.jpg" };
  const norm1 = vodParecidoNormalizar(item1, categories);
  assert.deepEqual(norm1, {
    id: "101",
    titulo: "Interestelar (2014)",
    grupo: "Ficção Científica",
    ano: 2014,
    nota: 8.6,
    capa: "https://img/101.jpg",
  });

  // 2. Série com series_id, cover, year, e category_id batendo
  const item2 = { series_id: 202, title: "Dark", category_id: "20", year: "2017", rating: "8.7", cover: "https://img/202.jpg" };
  const norm2 = vodParecidoNormalizar(item2, categories);
  assert.deepEqual(norm2, {
    id: "202",
    titulo: "Dark",
    grupo: "Suspense e Terror",
    ano: 2017,
    nota: 8.7,
    capa: "https://img/202.jpg",
  });

  // 3. Fallback para item.genre quando category_id não casa
  const item3 = { stream_id: "303", name: "Extra Film", category_id: "999", genre: "Aventura", year: 2021, cover: "c3.jpg" };
  const norm3 = vodParecidoNormalizar(item3, categories);
  assert.equal(norm3.id, "303");
  assert.equal(norm3.grupo, "Aventura");

  // 4. Fallback para item.category_name
  const item4 = { stream_id: "404", name: "Cat Name Film", category_name: "Gênero X", year: 2021, cover: "c4.jpg" };
  const norm4 = vodParecidoNormalizar(item4, categories);
  assert.equal(norm4.grupo, "Gênero X");

  // 5. Sem category_id, sem genre, sem category_name -> grupo vazio
  const item5 = { stream_id: "505", name: "Vazio", cover: "c5.jpg" };
  const norm5 = vodParecidoNormalizar(item5, categories);
  assert.equal(norm5.grupo, "");
  assert.equal(norm5.ano, 0);
  assert.equal(norm5.nota, 0);
});
