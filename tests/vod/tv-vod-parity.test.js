import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVodHelpers } from "./loadVodHelpers.js";
import { loadTvVodHelpers } from "./loadTvVodHelpers.js";

// Estes helpers vivem duplicados em sintoniza-link.html e sintoniza-tv.html.
// Este teste falha se as duas cópias divergirem — é a proteção contra drift
// silencioso entre os dois arquivos HTML.
const SHARED_FN_NAMES = [
  "providerKeyForItem", "attachProviders", "groupItemsByProvider",
  "dedupeVodItemsByTitle", "vodItemYearKey", "vodItemAddedTs", "selectNewestVodItems",
  "parseXtreamCredentials", "buildVodStreamUrl", "buildSeriesEpisodeUrl", "xtreamApiUrl",
];

test("sintoniza-tv.html's ported VOD helpers behave identically to sintoniza-link.html's", () => {
  const app = loadVodHelpers();
  const tv = loadTvVodHelpers();

  for (const name of SHARED_FN_NAMES) {
    assert.equal(typeof tv[name], "function", `${name} missing from the TV copy`);
  }

  // Comportamento idêntico em casos reais, não só presença da função.
  const sampleItem = { name: "Duna: Parte Dois", year: "2024", added: "100" };
  const seriesItem = { name: "The Bear", releaseDate: "2022-06-23", last_modified: "200" };
  const creds = { base: "http://x:80", username: "u", password: "p" };
  const providerMap = { "duna: parte dois|2024": ["max"], "the bear|2022": ["disney"] };

  assert.equal(app.providerKeyForItem(sampleItem), tv.providerKeyForItem(sampleItem));
  assert.equal(app.providerKeyForItem(seriesItem), tv.providerKeyForItem(seriesItem));
  assert.equal(app.vodItemYearKey(seriesItem), tv.vodItemYearKey(seriesItem));
  assert.equal(app.vodItemAddedTs(seriesItem), tv.vodItemAddedTs(seriesItem));

  assert.deepEqual(
    app.attachProviders([sampleItem, seriesItem], providerMap),
    tv.attachProviders([sampleItem, seriesItem], providerMap)
  );

  const enriched = app.attachProviders([sampleItem, seriesItem], providerMap);
  const order = ["netflix", "prime", "max", "disney", "apple", "paramount", "globoplay"];
  assert.deepEqual(
    app.groupItemsByProvider(enriched, order),
    tv.groupItemsByProvider(enriched, order)
  );

  // Item cujo provedor não está em providerOrder deve cair em "outros"
  // (correção do plano companheiro — não pode ser descartado).
  const oddball = app.attachProviders([sampleItem], { "duna: parte dois|2024": ["starzplay"] });
  assert.deepEqual(
    app.groupItemsByProvider(oddball, order),
    tv.groupItemsByProvider(oddball, order)
  );

  const dupes = [
    { name: "Duna: Parte Dois", year: "2024", added: "100" },
    { name: "Duna: Parte Dois", year: "2024", added: "300" },
    { name: "Duna: Parte Dois", year: "2021", added: "50" },
  ];
  assert.deepEqual(app.dedupeVodItemsByTitle(dupes), tv.dedupeVodItemsByTitle(dupes));
  assert.deepEqual(app.selectNewestVodItems(dupes, 2), tv.selectNewestVodItems(dupes, 2));

  const url = "http://host.tv:8080/get.php?username=u&password=p&type=m3u_plus";
  assert.equal(app.parseXtreamCredentials(url).base, tv.parseXtreamCredentials(url).base);
  assert.deepEqual(app.parseXtreamCredentials(url), tv.parseXtreamCredentials(url));
  assert.equal(app.parseXtreamCredentials("not a url"), tv.parseXtreamCredentials("not a url"));

  assert.equal(app.buildVodStreamUrl(creds, 42, "mkv"), tv.buildVodStreamUrl(creds, 42, "mkv"));
  assert.equal(app.buildVodStreamUrl(creds, 42), tv.buildVodStreamUrl(creds, 42));
  assert.equal(app.buildSeriesEpisodeUrl(creds, 7, "avi"), tv.buildSeriesEpisodeUrl(creds, 7, "avi"));
  assert.equal(
    app.xtreamApiUrl(creds, "get_vod_streams", { category_id: "5" }),
    tv.xtreamApiUrl(creds, "get_vod_streams", { category_id: "5" })
  );
});
