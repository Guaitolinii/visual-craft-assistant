import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";

test("sanitizeLabel tira caracteres que abrem HTML", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.sanitizeLabel('<img src=x onerror="alert(1)">ESPN'), "img src=x onerror=alert(1)ESPN");
  assert.equal(ctx.sanitizeLabel("A&E Brasil"), "A&E Brasil");
  assert.equal(ctx.sanitizeLabel(null), "");
});

test("sanitizeImageUrl só aceita http(s) sem aspas/espaços", () => {
  const ctx = loadVodHelpers();
  assert.equal(ctx.sanitizeImageUrl("https://cdn.x/logo.png"), "https://cdn.x/logo.png");
  assert.equal(ctx.sanitizeImageUrl('x" onerror="alert(1)'), "");
  assert.equal(ctx.sanitizeImageUrl("javascript:alert(1)"), "");
  assert.equal(ctx.sanitizeImageUrl(""), "");
});

test("sanitizeVodItem limpa nome, capa e plot do item da API", () => {
  const ctx = loadVodHelpers();
  const out = ctx.sanitizeVodItem({ stream_id: 1, name: "<b>Duna</b>", stream_icon: "javascript:x", cover: "https://c/d.jpg", plot: "<script>x</script>ok" });
  assert.equal(out.name, "bDuna/b");
  assert.equal(out.stream_icon, "");
  assert.equal(out.cover, "https://c/d.jpg");
  assert.equal(out.plot, "scriptx/scriptok");
  assert.equal(out.stream_id, 1);
});

test("parseM3U limpa nome, categoria e logo maliciosos", () => {
  const ctx = loadVodHelpers();
  const m3u = '#EXTM3U\n#EXTINF:-1 tvg-logo="x&quot; onerror=&quot;alert(1)" group-title="<b>Esportes</b>",<img src=x onerror=alert(1)>ESPN\nhttp://srv/live/u/p/1.ts\n';
  const [ch] = ctx.parseM3U(m3u);
  assert.equal(ch.name, "img src=x onerror=alert(1)ESPN");
  assert.equal(ch.category, "bEsportes/b");
  assert.equal(ch.logo, null);
});
