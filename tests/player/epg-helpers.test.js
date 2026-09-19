import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractInlineScriptById } from "../helpers/extractInlineScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-link.html");
const TV_HTML_PATH = path.join(__dirname, "..", "..", "sintoniza-tv", "sintoniza-tv.html");

export function loadEpgHelpers() {
  const source = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "epg-helpers.js" });
  return context;
}

const SAMPLE_XMLTV = `<?xml version="1.0" encoding="utf-8" ?><!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="CCCC_v3">
	<channel id="">
		<display-name>Sem ID FHD</display-name>
	</channel>
	<channel id="zoomoo.br">
		<display-name>Zoomoo FHD</display-name>
		<icon src="http://example.com/zoomoo.png" />
	</channel>
	<channel id="zoomoo.br">
		<display-name>Zoomoo [H265]</display-name>
	</channel>
	<programme start="20260913211500 -0300" stop="20260913212100 -0300" start_timestamp="1789344900" stop_timestamp="1789345260" channel="zoomoo.br" >
		<title>Flash, O Aventureiro</title>
		<desc>Uma dupla do barulho.</desc>
	</programme>
	<programme start="20260913212200 -0300" stop="20260913212800 -0300" start_timestamp="1789345320" stop_timestamp="1789345680" channel="zoomoo.br" >
		<title>Próximo Programa</title>
	</programme>
</tv>`;

test("normalizeChannelName: lowercases, strips accents and quality suffixes", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.normalizeChannelName("Canal Rural"), "canal rural");
  assert.equal(ctx.normalizeChannelName("Zoomoo FHD"), "zoomoo");
  assert.equal(ctx.normalizeChannelName("Zoomoo [H265]"), "zoomoo");
  assert.equal(ctx.normalizeChannelName("Canção Nova"), "cancao nova");
  assert.equal(ctx.normalizeChannelName(""), "");
  assert.equal(ctx.normalizeChannelName(null), "");
});

test("extractXmltvChannels: skips channels with an empty id", () => {
  const ctx = loadEpgHelpers();
  const channels = ctx.extractXmltvChannels(SAMPLE_XMLTV);
  assert.equal(channels.length, 2);
  assert.ok(channels.every((c) => c.id === "zoomoo.br"));
});

test("extractXmltvProgrammes: reads start/stop as epoch ms and the title", () => {
  const ctx = loadEpgHelpers();
  const programmes = ctx.extractXmltvProgrammes(SAMPLE_XMLTV);
  assert.equal(programmes.length, 2);
  assert.deepEqual(
    { channelId: programmes[0].channelId, start: programmes[0].start, stop: programmes[0].stop, title: programmes[0].title },
    { channelId: "zoomoo.br", start: 1789344900000, stop: 1789345260000, title: "Flash, O Aventureiro" }
  );
});

test("buildNameToProgrammesIndex: indexes programmes under every normalized name sharing a channel id", () => {
  const ctx = loadEpgHelpers();
  const channels = ctx.extractXmltvChannels(SAMPLE_XMLTV);
  const programmes = ctx.extractXmltvProgrammes(SAMPLE_XMLTV);
  const index = ctx.buildNameToProgrammesIndex(channels, programmes, { nowMs: 1789344900000 });

  assert.equal(index.zoomoo.length, 2);
  assert.equal(index.zoomoo[0].title, "Flash, O Aventureiro");
});

test("buildNameToProgrammesIndex: drops programmes outside the keep window", () => {
  const ctx = loadEpgHelpers();
  const channels = ctx.extractXmltvChannels(SAMPLE_XMLTV);
  const programmes = ctx.extractXmltvProgrammes(SAMPLE_XMLTV);
  const farFuture = 1789344900000 + 1000 * 60 * 60 * 24 * 365;
  const index = ctx.buildNameToProgrammesIndex(channels, programmes, { nowMs: farFuture });
  assert.equal(index.zoomoo, undefined);
});

test("getCurrentAndNextProgramme: finds the programme spanning now, and the one after it", () => {
  const ctx = loadEpgHelpers();
  const programmes = [
    { start: 1789344900000, stop: 1789345260000, title: "Atual" },
    { start: 1789345320000, stop: 1789345680000, title: "Próximo" },
  ];
  const result = ctx.getCurrentAndNextProgramme(programmes, 1789345000000);
  assert.equal(result.current.title, "Atual");
  assert.equal(result.next.title, "Próximo");
});

test("getCurrentAndNextProgramme: returns only next when nothing is airing yet", () => {
  const ctx = loadEpgHelpers();
  const programmes = [{ start: 1789345320000, stop: 1789345680000, title: "Próximo" }];
  const result = ctx.getCurrentAndNextProgramme(programmes, 1789344000000);
  assert.equal(result.current, null);
  assert.equal(result.next.title, "Próximo");
});

test("getCurrentAndNextProgramme: returns nulls for an empty schedule", () => {
  const ctx = loadEpgHelpers();
  const result = ctx.getCurrentAndNextProgramme([], Date.now());
  assert.equal(result.current, null);
  assert.equal(result.next, null);
});

test("isEpgCacheStale: true once the TTL has elapsed, false while still fresh", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.isEpgCacheStale(1000, 1000 + 6 * 60 * 60 * 1000, 6 * 60 * 60 * 1000), true);
  assert.equal(ctx.isEpgCacheStale(1000, 1000 + 60 * 1000, 6 * 60 * 60 * 1000), false);
});

test("isEpgCacheStale: treats a missing fetchedAt as stale", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.isEpgCacheStale(null, Date.now(), 6 * 60 * 60 * 1000), true);
});

test("epg-helpers block is byte-identical between sintoniza-link.html and sintoniza-tv.html", () => {
  const tvHtml = readFileSync(TV_HTML_PATH, "utf8");
  assert.ok(tvHtml.includes('<script id="epg-helpers">'), "sintoniza-tv.html is missing the epg-helpers block");
  const linkSource = extractInlineScriptById(LINK_HTML_PATH, "epg-helpers");
  const tvSource = extractInlineScriptById(TV_HTML_PATH, "epg-helpers");
  assert.equal(tvSource, linkSource);
});
