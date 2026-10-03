import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVodHelpers } from "../vod/loadVodHelpers.js";
import { LINK_HTML_PATH } from "./loadOtt.js";

const ID = "3f2b8c1e-9a77-4d0f-8a55-2b1c7e9d4a10";
const CREDS = { base: "http://srv.falso:8080", username: "usu", password: "sen" };

test("estado da sincronização do histórico: tolera lixo e só aceita listas de textos", () => {
  const h = loadVodHelpers();
  assert.deepEqual(h.histSyncParse(null), { feito: false, pendentes: [], remover: [] });
  assert.deepEqual(h.histSyncParse("não é json"), { feito: false, pendentes: [], remover: [] });
  assert.deepEqual(h.histSyncParse('{"feito":true,"pendentes":["f:1",5,null],"remover":"x"}'), { feito: true, pendentes: ["f:1"], remover: [] });
});

test("gravar/remover no histórico: sem confirmação da conta fica pendente; com confirmação sai da pendência", () => {
  const h = loadVodHelpers();
  const base = { feito: true, pendentes: ["f:1"], remover: ["c:espn"] };
  assert.deepEqual(h.histSyncMark(base, "e:2", true, false), { feito: true, pendentes: ["f:1", "e:2"], remover: ["c:espn"] });
  assert.deepEqual(h.histSyncMark(base, "f:1", true, true), { feito: true, pendentes: [], remover: ["c:espn"] });
  // removeu um que estava pendente de envio: não precisa mais enviar, mas precisa remover na conta
  assert.deepEqual(h.histSyncMark(base, "f:1", false, false), { feito: true, pendentes: [], remover: ["c:espn", "f:1"] });
  // voltou a assistir um que estava para remover
  assert.deepEqual(h.histSyncMark(base, "c:espn", true, false), { feito: true, pendentes: ["f:1", "c:espn"], remover: [] });
});

test("o estado da sincronização do histórico é por perfil (sint_p<id8>_histsync)", () => {
  const h = loadVodHelpers();
  assert.equal(h.profKeyFor("sint_histsync", ID), "sint_p3f2b8c1e_histsync");
  assert.equal(h.profKeyFor("sint_histsync", null), "sint_histsync");
});

test("abrir um cartão que veio da conta: o link é montado com as credenciais de agora; sem credenciais não abre", () => {
  const h = loadVodHelpers();
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod", ext: "mkv", vodItem: { stream_id: "5" } }, CREDS), "http://srv.falso:8080/movie/usu/sen/5.mkv");
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod", vodItem: { stream_id: "5", container_extension: "avi" } }, CREDS), "http://srv.falso:8080/movie/usu/sen/5.avi");
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod" }, CREDS), "http://srv.falso:8080/movie/usu/sen/5.mp4");
  assert.equal(h.histResumeUrl({ id: "resume-series-9", type: "series", ext: "mp4" }, CREDS), "http://srv.falso:8080/series/usu/sen/9.mp4");
  // já tem link (foi assistido neste aparelho): usa o dele
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod", url: "http://antigo/movie/a/b/5.mp4" }, CREDS), "http://antigo/movie/a/b/5.mp4");
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod", url: "http://antigo/movie/a/b/5.mp4" }, null), "http://antigo/movie/a/b/5.mp4");
  // sem credenciais ou id estranho: nada
  assert.equal(h.histResumeUrl({ id: "resume-vod-5", type: "vod" }, null), "");
  assert.equal(h.histResumeUrl({ id: "resume-vod-5/../x", type: "vod" }, CREDS), "");
  assert.equal(h.histResumeUrl({ id: "qualquer", type: "series" }, CREDS), "");
});

test("ligação no app: gravar, remover, perfil escolhido, canais e voltar ao app", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  assert.match(html, /async function syncHistory\(/);
  // o estado por perfil entra nas bases por perfil
  assert.match(html, /const PER_PROFILE_BASES = \[[^\]]*"sint_histsync"[^\]]*\]/);
  // só sincroniza depois de escolher o perfil; profileChoose dispara
  assert.match(html, /async function syncHistory\(\)[\s\S]*?!_profile\.chosen/);
  assert.match(html, /function profileChoose\(p\)[\s\S]*?histSyncStart\(\)/);
  // a lista de canais carregada dispara a sincronização (canais recentes esperam a lista)
  assert.match(html, /syncFavorites\(\);[^\n]*\n\s*syncHistory\(\);/);
  // o minuto do filme/episódio vai para a conta junto do salvamento local (throttle) e ao pausar/sair
  assert.match(html, /function saveContinueWatching\(entry\)[\s\S]*?histPush\(/);
  assert.match(html, /pushProgressToAccount\(true\); \/\/ pausou[^\n]*\n\s*histPutCurrent\(true\)/);
  assert.match(html, /if \(document\.visibilityState === "hidden"\) pushProgressToAccount\(true\);[^\n]*\n\s*if \(document\.visibilityState === "hidden"\) histPutCurrent\(true\)/);
  // escolher um canal grava o canal; remover do continuar/recentes remove na conta
  assert.match(html, /function selectChannel\([\s\S]*?histPush\(ottHistItemsFromChannels\(/);
  assert.match(html, /function removeContinueWatching\(id\)[\s\S]*?histDrop\(ottHistKeyFromContinueId\(id\)\)/);
  assert.match(html, /recent-remove[\s\S]*?histDrop\(ottHistKeyChannel\(/);
  // cartão que veio da conta (sem link): monta o link com as credenciais atuais e avisa se não houver
  assert.match(html, /card\.dataset\.vodResume === "1"[\s\S]*?histResumeUrl\(item, creds\)/);
});

test("nenhuma referência a ott* do histórico fora de funções (o carregador de testes não tem o ott-core)", () => {
  const html = readFileSync(LINK_HTML_PATH, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const principal = scripts[scripts.length - 1][1];
  // as constantes e o estado do histórico são declarados no nível do script e não podem usar o ott-core
  const nivelRaiz = principal.split(/\r?\n/).filter((l) => /^(const|let|var) /.test(l) && /hist/i.test(l));
  assert.ok(nivelRaiz.length > 0);
  for (const l of nivelRaiz) assert.doesNotMatch(l, /\bott[A-Z]/, "no nível do script: " + l);
});
