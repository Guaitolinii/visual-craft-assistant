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

test("decodeXmlEntities: decodes the standard XML entities and numeric references", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.decodeXmlEntities("Discovery H&amp;H"), "Discovery H&H");
  assert.equal(ctx.decodeXmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(ctx.decodeXmlEntities("&lt;tag&gt; &quot;quoted&quot; &apos;s&apos;"), `<tag> "quoted" 's'`);
  assert.equal(ctx.decodeXmlEntities("&#65;&#x42;"), "AB");
  assert.equal(ctx.decodeXmlEntities("no entities here"), "no entities here");
  assert.equal(ctx.decodeXmlEntities(""), "");
});

test("normalizeChannelName: lowercases, strips accents and quality suffixes", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.normalizeChannelName("Canal Rural"), "canal rural");
  assert.equal(ctx.normalizeChannelName("Zoomoo FHD"), "zoomoo");
  assert.equal(ctx.normalizeChannelName("Zoomoo [H265]"), "zoomoo");
  assert.equal(ctx.normalizeChannelName("Canção Nova"), "cancao nova");
  assert.equal(ctx.normalizeChannelName(""), "");
  assert.equal(ctx.normalizeChannelName(null), "");
});

test("normalizeChannelName: translates & and + into words instead of dropping them", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.normalizeChannelName("Discovery H&H"), "discovery h and h");
  assert.equal(ctx.normalizeChannelName("A&E"), "a and e");
  assert.equal(ctx.normalizeChannelName("Paramount+"), "paramount plus");
});

test("normalizeChannelName: strips a leading City/UF region prefix (epgshare01 dialect)", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.normalizeChannelName("São Paulo/SP  SporTV HD ³"), "sportv");
  assert.equal(ctx.normalizeChannelName("Belo Horizonte/MG  Premiere 6"), "premiere 6");
  assert.equal(ctx.normalizeChannelName("São Paulo/SP   TV Brasil 2"), "tv brasil 2");
  // Sem prefixo de regiao, nao deve mexer em nada (não é todo provedor que usa esse formato).
  assert.equal(ctx.normalizeChannelName("Zoomoo FHD"), "zoomoo");
});

test("parseXmltvDate: parses YYYYMMDDHHmmss with a UTC offset into epoch ms", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.parseXmltvDate("20260918050000 +0000"), Date.UTC(2026, 8, 18, 5, 0, 0));
  assert.equal(ctx.parseXmltvDate("20260913211500 -0300"), Date.UTC(2026, 8, 13, 21 + 3, 15, 0));
});

test("parseXmltvDate: defaults to +0000 when no offset is given", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.parseXmltvDate("20260918050000"), Date.UTC(2026, 8, 18, 5, 0, 0));
});

test("parseXmltvDate: returns NaN for unparseable input", () => {
  const ctx = loadEpgHelpers();
  assert.ok(Number.isNaN(ctx.parseXmltvDate("not a date")));
  assert.ok(Number.isNaN(ctx.parseXmltvDate("")));
  assert.ok(Number.isNaN(ctx.parseXmltvDate(null)));
});

test("mergeEpgIndexes: keeps the primary source's entry when both have the same name", () => {
  const ctx = loadEpgHelpers();
  const primary = { sportv: [{ start: 1, stop: 2, title: "Fonte principal" }] };
  const extra = { sportv: [{ start: 9, stop: 10, title: "Fonte secundaria" }] };
  const merged = ctx.mergeEpgIndexes(primary, extra);
  assert.equal(merged.sportv, primary.sportv);
});

test("mergeEpgIndexes: fills in names the primary source is missing", () => {
  const ctx = loadEpgHelpers();
  const primary = { zoomoo: [{ start: 1, stop: 2, title: "X" }] };
  const extra = { espn: [{ start: 3, stop: 4, title: "Y" }] };
  const merged = ctx.mergeEpgIndexes(primary, extra);
  assert.equal(merged.zoomoo, primary.zoomoo);
  assert.equal(merged.espn, extra.espn);
});

test("resolveEpgProgrammes: falls back to the canonical alias when the exact name is missing", () => {
  const ctx = loadEpgHelpers();
  const index = { "premiere clubes": [{ start: 1, stop: 2, title: "Jogo" }] };
  assert.equal(ctx.resolveEpgProgrammes(index, "premiere 1"), index["premiere clubes"]);
  assert.equal(ctx.resolveEpgProgrammes(index, "premiere"), index["premiere clubes"]);
});

test("resolveEpgProgrammes: prefers an exact match over the alias", () => {
  const ctx = loadEpgHelpers();
  const index = {
    "premiere clubes": [{ start: 1, stop: 2, title: "Jogo A" }],
    "premiere 1": [{ start: 3, stop: 4, title: "Jogo B" }],
  };
  assert.equal(ctx.resolveEpgProgrammes(index, "premiere 1"), index["premiere 1"]);
});

test("resolveEpgProgrammes: returns null when neither the name nor its alias exist", () => {
  const ctx = loadEpgHelpers();
  assert.equal(ctx.resolveEpgProgrammes({}, "canal rural"), null);
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

test("extractXmltvChannels: reads the display-name even with a lang attribute and a <url> sibling (epgshare01 dialect)", () => {
  const ctx = loadEpgHelpers();
  const xml = `<tv>
    <channel id="São.Paulo/SP..SporTV.br">
      <url>http://www.clarotv.com.br</url>
      <display-name lang="pt">São Paulo/SP  SporTV</display-name>
    </channel>
  </tv>`;
  const channels = ctx.extractXmltvChannels(xml);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, "São.Paulo/SP..SporTV.br");
  assert.equal(channels[0].displayName, "São Paulo/SP  SporTV");
});

test("extractXmltvProgrammes: falls back to parsing start/stop when start_timestamp is absent (epgshare01 dialect)", () => {
  const ctx = loadEpgHelpers();
  const xml = `<tv>
    <programme channel="ESPN.5.br" start="20260918050000 +0000" stop="20260918060000 +0000">
      <title lang="pt">Bola da Vez</title>
    </programme>
  </tv>`;
  const programmes = ctx.extractXmltvProgrammes(xml);
  assert.equal(programmes.length, 1);
  assert.deepEqual(
    { channelId: programmes[0].channelId, start: programmes[0].start, stop: programmes[0].stop, title: programmes[0].title },
    { channelId: "ESPN.5.br", start: Date.UTC(2026, 8, 18, 5, 0, 0), stop: Date.UTC(2026, 8, 18, 6, 0, 0), title: "Bola da Vez" }
  );
});

test("extractXmltvProgrammes: skips a programme whose start/stop can't be parsed at all", () => {
  const ctx = loadEpgHelpers();
  const xml = `<tv><programme channel="X" start="garbage" stop="also garbage"><title>Y</title></programme></tv>`;
  assert.equal(ctx.extractXmltvProgrammes(xml).length, 0);
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

test("formatProgrammeTimeRange: formats start-stop as local HH:MM-HH:MM", () => {
  const ctx = loadEpgHelpers();
  const start = new Date(2026, 8, 13, 21, 15, 0).getTime();
  const stop = new Date(2026, 8, 13, 21, 22, 0).getTime();
  assert.equal(ctx.formatProgrammeTimeRange(start, stop), "21:15–21:22");
});

test("formatProgrammeTimeRange: pads single-digit hours and minutes", () => {
  const ctx = loadEpgHelpers();
  const start = new Date(2026, 8, 13, 5, 5, 0).getTime();
  const stop = new Date(2026, 8, 13, 5, 9, 0).getTime();
  assert.equal(ctx.formatProgrammeTimeRange(start, stop), "05:05–05:09");
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
