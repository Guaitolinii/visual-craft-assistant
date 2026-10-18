import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import path from "node:path";

export function decodeXmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(Number(code));
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, code) {
      return String.fromCharCode(parseInt(code, 16));
    })
    .replace(/&amp;/g, "&");
}

export function normalizeChannelName(name) {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[^/\n]+\/[A-Za-z]{2}\s+/, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(fhd|uhd|4k|hd|sd)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseXmltvDate(str) {
  if (!str) return NaN;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(
    String(str).trim()
  );
  if (!m) return NaN;
  const offset = m[7] || "+0000";
  const iso =
    m[1] +
    "-" +
    m[2] +
    "-" +
    m[3] +
    "T" +
    m[4] +
    ":" +
    m[5] +
    ":" +
    m[6] +
    offset[0] +
    offset.slice(1, 3) +
    ":" +
    offset.slice(3, 5);
  return Date.parse(iso);
}

export function truncateDesc(text, max) {
  if (typeof text !== "string") return "";
  const limit = typeof max === "number" && max > 0 ? max : 240;
  if (text.length <= limit) return text;
  const target = limit - 1;
  const sliced = text.slice(0, target);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace !== -1 && lastSpace > 0) {
    return sliced.slice(0, lastSpace).replace(/\s+$/, "") + "…";
  }
  return sliced.replace(/\s+$/, "") + "…";
}

export function construirEpgExtra(xmlText, agoraMs) {
  const agora = typeof agoraMs === "number" && !isNaN(agoraMs) ? agoraMs : Date.now();
  const resultado = {
    v: 1,
    gerado: agora,
    canais: {},
  };

  if (typeof xmlText !== "string" || !xmlText.trim()) {
    return resultado;
  }

  // Mapeia id do canal para conjunto de nomes normalizados
  const idToNames = new Map();
  const chanRegex = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let chanMatch;
  while ((chanMatch = chanRegex.exec(xmlText))) {
    const id = chanMatch[1];
    if (!id) continue;
    const body = chanMatch[2];
    const nameRegex = /<display-name[^>]*>([^<]*)<\/display-name>/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(body))) {
      const rawName = decodeXmlEntities(nameMatch[1]);
      const norm = normalizeChannelName(rawName);
      if (!norm) continue;
      if (!idToNames.has(id)) {
        idToNames.set(id, new Set());
      }
      idToNames.get(id).add(norm);
    }
  }

  if (idToNames.size === 0) {
    return resultado;
  }

  // Janela: fim > agora - 2h e inicio < agora + 36h
  const minStopMs = agora - 2 * 3600 * 1000;
  const maxStartMs = agora + 36 * 3600 * 1000;

  const progsByChannel = new Map();
  const progRegex = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  let progMatch;

  while ((progMatch = progRegex.exec(xmlText))) {
    const attrs = progMatch[1];
    const body = progMatch[2];

    const chanAttr = /channel="([^"]*)"/.exec(attrs);
    if (!chanAttr) continue;
    const channelId = chanAttr[1];
    const targetNames = idToNames.get(channelId);
    if (!targetNames || targetNames.size === 0) continue;

    const startTsMatch = /start_timestamp="(\d+)"/.exec(attrs);
    const stopTsMatch = /stop_timestamp="(\d+)"/.exec(attrs);
    const startMatch = /\bstart="([^"]*)"/.exec(attrs);
    const stopMatch = /\bstop="([^"]*)"/.exec(attrs);

    const startMs = startTsMatch
      ? Number(startTsMatch[1]) * 1000
      : (startMatch ? parseXmltvDate(startMatch[1]) : NaN);
    const stopMs = stopTsMatch
      ? Number(stopTsMatch[1]) * 1000
      : (stopMatch ? parseXmltvDate(stopMatch[1]) : NaN);

    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) continue;
    if (stopMs <= startMs) continue;

    // Filtro da janela
    if (stopMs <= minStopMs || startMs >= maxStartMs) continue;

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/.exec(body);
    if (!titleMatch) continue;
    const rawTitle = decodeXmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
    if (!rawTitle) continue;
    const title = truncateDesc(rawTitle, 80);

    let sinopse = "";
    const descMatch = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(body);
    if (descMatch) {
      const rawDesc = decodeXmlEntities(descMatch[1]).replace(/\s+/g, " ").trim();
      sinopse = truncateDesc(rawDesc, 160);
    }

    const startSeg = Math.floor(startMs / 1000);
    const stopSeg = Math.floor(stopMs / 1000);

    const progEntry = [startSeg, stopSeg, title, sinopse];

    for (const normName of targetNames) {
      if (!progsByChannel.has(normName)) {
        progsByChannel.set(normName, []);
      }
      progsByChannel.get(normName).push(progEntry);
    }
  }

  // Ordena canais por nome e desduplica programas por início
  const sortedNames = Array.from(progsByChannel.keys()).sort();
  for (const name of sortedNames) {
    const list = progsByChannel.get(name);
    // Agrupa por startSeg, preferindo entrada com sinopse caso haja duplicata de início
    const byStart = new Map();
    for (const prog of list) {
      const start = prog[0];
      if (!byStart.has(start)) {
        byStart.set(start, prog);
      } else {
        const existing = byStart.get(start);
        if (!existing[3] && prog[3]) {
          byStart.set(start, prog);
        }
      }
    }

    const deduped = Array.from(byStart.values()).sort((a, b) => a[0] - b[0]);
    if (deduped.length > 0) {
      resultado.canais[name] = deduped;
    }
  }

  return resultado;
}

export async function main() {
  const defaultUrl = "https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz";
  const url = process.env.EPG_FONTE_URL || defaultUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  let buffer;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`Falha HTTP ao baixar EPG: ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }

  let xmlText;
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    xmlText = gunzipSync(buffer).toString("utf8");
  } else {
    try {
      xmlText = gunzipSync(buffer).toString("utf8");
    } catch {
      xmlText = buffer.toString("utf8");
    }
  }

  const agoraMs = Date.now();
  const epg = construirEpgExtra(xmlText, agoraMs);

  const canais = epg.canais || {};
  const channelNames = Object.keys(canais);
  const totalChannels = channelNames.length;
  let totalProgrammes = 0;
  for (const ch of channelNames) {
    totalProgrammes += canais[ch].length;
  }

  if (totalChannels < 20 || totalProgrammes < 500) {
    console.error(
      `Validação falhou: ${totalChannels} canais, ${totalProgrammes} programas (mínimo: 20 canais e 500 programas). Nenhum arquivo gravado.`
    );
    process.exit(1);
  }

  const json = JSON.stringify(epg);
  writeFileSync("epg-extra.json", json, "utf8");

  const kb = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  console.log(`EPG gerado: ${totalChannels} canais, ${totalProgrammes} programas, ${kb} KB`);
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Erro na geração do EPG extra:", err.message || err);
    process.exit(1);
  });
}
