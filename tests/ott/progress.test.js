import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain, fakeFetch } from "./loadOtt.js";

const cfg = { url: "https://x.supabase.co", anonKey: "chave", panelUrl: "https://sintonizatv.com.br" };
const T = (iso) => Date.parse(iso);

test("chave do item na conta: filme e episódio; lixo vira null", () => {
  const o = loadOtt();
  assert.equal(o.ottProgressKey("vod", "123"), "vod:123");
  assert.equal(o.ottProgressKey("episode", "77"), "ep:77");
  assert.equal(o.ottProgressKey("vod", ""), null);
  assert.equal(o.ottProgressKey("vod", "12;x"), null);
  assert.equal(o.ottProgressKey("channel", "1"), null);
});

test("regra do minuto: o mais recente vale; começo curto e final são descartados", () => {
  const o = loadOtt();
  const base = { localSec: 0, localTs: 0, serverSec: 0, serverTs: 0, durationSec: 6000, minSec: 10 };
  assert.equal(o.ottPickResume({ ...base, localSec: 100, localTs: T("2026-10-03T10:00:00Z"), serverSec: 2000, serverTs: T("2026-10-03T11:00:00Z") }), 2000);
  assert.equal(o.ottPickResume({ ...base, localSec: 3000, localTs: T("2026-10-03T12:00:00Z"), serverSec: 2000, serverTs: T("2026-10-03T11:00:00Z") }), 3000);
  assert.equal(o.ottPickResume({ ...base, serverSec: 900, serverTs: 5 }), 900);
  assert.equal(o.ottPickResume({ ...base, localSec: 5, localTs: 5 }), 0);
  assert.equal(o.ottPickResume({ ...base, localSec: 5950, localTs: 5 }), 0);
});

test("lê, grava e apaga o progresso na conta", async () => {
  const o = loadOtt();
  const g = fakeFetch(() => ({ body: { status: "ok", found: true, position_sec: 1234, duration_sec: 6000, updated_at: "2026-10-03T11:00:00.123456+00:00" } }));
  assert.deepEqual(plain(await o.ottProgressGet(cfg, "tok", "vod:1", g)), { sec: 1234, durationSec: 6000, ts: Date.UTC(2026, 9, 3, 11, 0, 0, 123) });
  assert.deepEqual(JSON.parse(g.calls[0].init.body), { p_token: "tok", p_key: "vod:1" });
  assert.equal(await o.ottProgressGet(cfg, "tok", "vod:1", fakeFetch(() => ({ body: { status: "ok", found: false } }))), null);
  const p = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressPut(cfg, "tok", "ep:7", "episode", 321.9, 2400.2, p);
  assert.deepEqual(JSON.parse(p.calls[0].init.body), { p_token: "tok", p_key: "ep:7", p_kind: "episode", p_position: 321, p_duration: 2400 });
  const c = fakeFetch(() => ({ body: { status: "ok" } }));
  await o.ottProgressClear(cfg, "tok", "ep:7", c);
  assert.ok(c.calls[0].url.endsWith("/rpc/progress_clear"));
});

test("o envio leva a posição atual (positionSec) em filme e episódio, não em canal", () => {
  const o = loadOtt();
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X", year: "2023" }, { positionSec: 754.8 })), { streamId: "10", title: "Filme X", year: 2023, positionSec: 754 });
  assert.deepEqual(plain(o.ottBuildCastPayload("vod", { stream_id: 10, name: "Filme X" })), { streamId: "10", title: "Filme X", year: 0 });
  assert.deepEqual(plain(o.ottBuildCastPayload("episode", { series_id: 7, name: "Série Y" }, { season: "2", episode: "5", positionSec: 90 })), { seriesId: "7", title: "Série Y", season: 2, episode: 5, positionSec: 90 });
  assert.deepEqual(plain(o.ottBuildCastPayload("channel", { name: "Globo" }, { positionSec: 99 })), { name: "Globo", group: "" });
});
