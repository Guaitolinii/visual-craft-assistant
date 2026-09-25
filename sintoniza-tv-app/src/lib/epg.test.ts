// sintoniza-tv-app/src/lib/epg.test.ts
import { describe, test, expect } from 'vitest';
import {
  decodeXmlEntities,
  normalizeChannelName,
  parseXmltvDate,
  extractXmltvChannels,
  extractXmltvProgrammes,
  buildNameToProgrammesIndex,
  getCurrentAndNextProgramme,
  isEpgCacheStale,
  formatProgrammeTimeRange,
  mergeEpgIndexes,
  resolveEpgProgrammes,
} from './epg';

test('decodeXmlEntities decodifica entidades comuns', () => {
  expect(decodeXmlEntities('A &amp; B &lt;tag&gt; &quot;x&quot;')).toBe('A & B <tag> "x"');
});

test('normalizeChannelName remove região, HD/SD, colchetes e normaliza', () => {
  expect(normalizeChannelName('São Paulo/SP  SporTV HD')).toBe('sportv');
  expect(normalizeChannelName('ESPN+ [H265]')).toBe('espn plus');
});

test('parseXmltvDate converte formato XMLTV para epoch', () => {
  const ms = parseXmltvDate('20260101120000 +0000');
  expect(new Date(ms).getUTCFullYear()).toBe(2026);
});

test('extractXmltvChannels e extractXmltvProgrammes leem um XMLTV simples', () => {
  const xml = `<tv><channel id="c1"><display-name lang="pt">Canal Um</display-name></channel>
    <programme channel="c1" start_timestamp="1700000000" stop_timestamp="1700003600"><title>Jornal</title></programme></tv>`;
  const channels = extractXmltvChannels(xml);
  expect(channels).toEqual([{ id: 'c1', displayName: 'Canal Um' }]);
  const programmes = extractXmltvProgrammes(xml);
  expect(programmes[0]).toMatchObject({ channelId: 'c1', title: 'Jornal' });
});

test('buildNameToProgrammesIndex e getCurrentAndNextProgramme encontram o programa atual', () => {
  const channels = [{ id: 'c1', displayName: 'Canal Um' }];
  const now = 1700001000000 / 1000 * 1000; // dentro da janela do programa
  const programmes = [{ channelId: 'c1', start: 1700000000000, stop: 1700003600000, title: 'Jornal' }];
  const index = buildNameToProgrammesIndex(channels, programmes, { nowMs: now });
  const { current } = getCurrentAndNextProgramme(index['canal um'], now);
  expect(current?.title).toBe('Jornal');
});

test('isEpgCacheStale respeita o TTL', () => {
  expect(isEpgCacheStale(0, 1000, 500)).toBe(true);
  expect(isEpgCacheStale(1000, 1200, 500)).toBe(false);
});

test('formatProgrammeTimeRange formata HH:mm–HH:mm', () => {
  const start = new Date(2026, 0, 1, 8, 0).getTime();
  const stop = new Date(2026, 0, 1, 9, 30).getTime();
  expect(formatProgrammeTimeRange(start, stop)).toBe('08:00–09:30');
});

test('mergeEpgIndexes prioriza o índice do provedor e completa com o suplementar', () => {
  const primary = { canal: [{ start: 1, stop: 2, title: 'A' }] };
  const supplementary = { canal: [{ start: 9, stop: 10, title: 'B' }], outro: [{ start: 1, stop: 2, title: 'C' }] };
  const merged = mergeEpgIndexes(primary, supplementary);
  expect(merged.canal[0].title).toBe('A');
  expect(merged.outro[0].title).toBe('C');
});

test('resolveEpgProgrammes usa apelidos quando o nome direto não bate', () => {
  const index = { 'premiere clubes': [{ start: 1, stop: 2, title: 'Jogo' }] };
  expect(resolveEpgProgrammes(index, 'premiere 1')?.[0].title).toBe('Jogo');
  expect(resolveEpgProgrammes(index, 'canal inexistente')).toBeNull();
});
