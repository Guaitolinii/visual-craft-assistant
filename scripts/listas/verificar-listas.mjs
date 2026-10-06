#!/usr/bin/env node
// Verifica, um por um, o que REALMENTE funciona numa lista IPTV e monta listas só com o que funciona.
//   canais  -> cada canal ao vivo (HLS): manifesto, trechos, velocidade e codecs reais
//   filmes  -> cada filme: o arquivo responde, é vídeo de verdade (não HTML), tamanho, formato e se aceita Range (avançar/voltar)
//   series  -> cada série (agrupa os episódios pelo nome "S01E02"): testa o 1º episódio, ou todos com --episodios todos
// SÓ LEITURA: nunca altera nada na lista nem no provedor, só faz pedidos de leitura (GET com Range pequeno para filmes/séries).
// Sem dependências (Node 18+). Os links (com usuário e senha) NUNCA ficam no código: vêm de variável de ambiente ou de --lista,
// e nenhum relatório/CSV/log traz usuário ou senha (só o arquivo ok*.m3u traz as URLs reais, porque é a lista final: trate como segredo).
//
// Uso:
//   LISTA_CANAIS="<link da lista de canais>"  node scripts/listas/verificar-listas.mjs canais
//   LISTA_VOD="<link da lista de filmes e séries>" node scripts/listas/verificar-listas.mjs filmes
//   LISTA_VOD="<link da lista de filmes e séries>" node scripts/listas/verificar-listas.mjs series
// Opções: --lista <link|arquivo>   --saida <pasta>   --concorrencia 2   --pausa 200 (ms entre pedidos)   --amostra N (só N itens, para testar)
//         --filtro <texto> (só itens cujo nome/grupo contenha)   --retomar (continua de onde parou)   --episodios todos   --profundo (canais: baixa o trecho inteiro)
// Cuidado com o provedor: o padrão é gentil (2 em paralelo). Se vier muito 401/403/429 seguido, o script PARA sozinho (possível bloqueio da conta).
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ───────────── argumentos ─────────────
const [, , modo, ...resto] = process.argv;
const opt = { concorrencia: 2, pausa: 200, amostra: 0, filtro: '', retomar: false, episodios: 'primeiro', profundo: false, saida: '', lista: '' };
for (let i = 0; i < resto.length; i++) {
  const a = resto[i];
  const v = () => resto[++i];
  if (a === '--lista') opt.lista = v();
  else if (a === '--saida') opt.saida = v();
  else if (a === '--concorrencia') opt.concorrencia = Math.max(1, Math.min(8, Number(v()) || 2));
  else if (a === '--pausa') opt.pausa = Math.max(0, Number(v()) || 0);
  else if (a === '--amostra') opt.amostra = Math.max(0, Number(v()) || 0);
  else if (a === '--filtro') opt.filtro = String(v() || '').toLowerCase();
  else if (a === '--retomar') opt.retomar = true;
  else if (a === '--episodios') opt.episodios = v() === 'todos' ? 'todos' : 'primeiro';
  else if (a === '--profundo') opt.profundo = true;
}
if (!['canais', 'filmes', 'series'].includes(modo)) {
  console.error('Uso: node scripts/listas/verificar-listas.mjs <canais|filmes|series> [opções]  (veja o cabeçalho do arquivo)');
  process.exit(1);
}
const fonte = opt.lista || (modo === 'canais' ? process.env.LISTA_CANAIS : process.env.LISTA_VOD) || '';
if (!fonte) {
  console.error(`Falta a lista: defina ${modo === 'canais' ? 'LISTA_CANAIS' : 'LISTA_VOD'} ou use --lista <link|arquivo>.`);
  process.exit(1);
}

const UA = { 'user-agent': 'VLC/3.0.20 LibVLC/3.0.20' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mascara = (s) => String(s).replace(/(https?:\/\/[^\s"']+)/g, (u) => { try { const x = new URL(u); return x.protocol + '//' + x.host + '/…'; } catch (e) { return 'url'; } });

// ───────────── lista M3U ─────────────
async function lerLista(origem) {
  let texto;
  if (/^https?:\/\//i.test(origem)) {
    const r = await fetch(origem, { headers: UA, signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error('não consegui baixar a lista (HTTP ' + r.status + ')');
    texto = await r.text();
  } else {
    texto = readFileSync(origem, 'utf8');
  }
  const itens = [];
  let info = '';
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    if (l.startsWith('#EXTINF')) info = l;
    else if (/^https?:\/\//i.test(l)) {
      const grupo = (/group-title="([^"]*)"/.exec(info) || [])[1] || '';
      const m = /",\s*(.*)$/.exec(info) || /,([^,]*)$/.exec(info);
      itens.push({ nome: ((m && m[1]) || '').trim() || 'sem nome', grupo, url: l, extinf: info });
      info = '';
    }
  }
  return itens;
}

// ───────────── utilidades de rede ─────────────
async function pedir(url, { timeout = 30000, range = null, limite = 0 } = {}) {
  const t0 = Date.now();
  const headers = { ...UA };
  if (range) headers.Range = range;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  const ttfb = Date.now() - t0;
  const partes = [];
  let total = 0;
  const leitor = r.body ? r.body.getReader() : null;
  while (leitor) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value);
    total += value.length;
    if (limite && total >= limite) { try { await leitor.cancel(); } catch (e) { /* ignora */ } break; }
  }
  return { status: r.status, headers: r.headers, corpo: Buffer.concat(partes), ttfb, ms: Date.now() - t0, urlFinal: r.url };
}

// Tenta de novo uma vez em erro de rede/timeout/5xx
async function pedirComRetentativa(url, opcoes) {
  try {
    const r = await pedir(url, opcoes);
    if (r.status >= 500) { await dormir(2000); return await pedir(url, opcoes); }
    return r;
  } catch (e) {
    await dormir(2000);
    return pedir(url, opcoes);
  }
}

const ehHtml = (buf, ct) => /text\/html/i.test(ct || '') || /^\s*<(!doctype|html|head|\?xml)/i.test(buf.slice(0, 80).toString('latin1'));
const abs = (base, ref) => new URL(ref, base).href;

// ───────────── canais: leitura do transporte (PAT/PMT) ─────────────
const TIPOS_TS = { 0x01: 'MPEG1-vídeo', 0x02: 'MPEG2-vídeo', 0x03: 'MPEG1-áudio', 0x04: 'MPEG-áudio', 0x0f: 'AAC-ADTS', 0x11: 'AAC-LATM', 0x1b: 'H.264', 0x24: 'HEVC', 0x81: 'AC-3', 0x87: 'E-AC-3', 0x06: 'privado', 0x15: 'metadados', 0x86: 'SCTE-35' };
function fluxosTs(buf) {
  let pmtPid = -1;
  for (let o = 0; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) { const k = buf.indexOf(0x47, o + 1); if (k < 0) break; o = k - 188; continue; }
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    const pusi = buf[o + 1] & 0x40;
    const afc = (buf[o + 3] >> 4) & 3;
    let p = o + 4;
    if (afc & 2) p += 1 + buf[o + 4];
    if (!(afc & 1) || !pusi) continue;
    p += 1 + buf[p];
    if (pid === 0 && pmtPid < 0) pmtPid = ((buf[p + 10] & 0x1f) << 8) | buf[p + 11];
    else if (pid === pmtPid && pmtPid >= 0) {
      const secLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
      const infoLen = ((buf[p + 10] & 0x0f) << 8) | buf[p + 11];
      let q = p + 12 + infoLen;
      const fim = p + 3 + secLen - 4;
      const out = [];
      while (q + 5 <= fim) { out.push(TIPOS_TS[buf[q]] || '0x' + buf[q].toString(16)); q += 5 + (((buf[q + 3] & 0x0f) << 8) | buf[q + 4]); }
      return out;
    }
  }
  return [];
}

// Avaliação dos codecs para o navegador (hls.js): H.264 + AAC/MP3 toca; o resto dá problema
function avaliarCodecs(fluxos) {
  const video = fluxos.filter((f) => /H\.264|HEVC|MPEG\d-vídeo/.test(f));
  const audio = fluxos.filter((f) => /AAC|AC-3|MPEG.*áudio/.test(f));
  const ruins = [];
  if (video.includes('HEVC')) ruins.push('HEVC (só alguns navegadores)');
  if (video.some((v) => /MPEG\d-vídeo/.test(v)) && !video.includes('H.264')) ruins.push('MPEG-2 (navegador não toca)');
  if (audio.includes('AAC-LATM') && !audio.includes('AAC-ADTS')) ruins.push('áudio AAC-LATM (hls.js não lê)');
  if ((audio.includes('AC-3') || audio.includes('E-AC-3')) && !audio.some((a) => /AAC-ADTS|MPEG.*áudio/.test(a))) ruins.push('áudio AC-3/E-AC-3 (navegador não toca)');
  return { ruins, video, audio };
}

// ───────────── canais: verificação de um canal ─────────────
async function verificarCanal(item) {
  const res = { tipo: 'canal', nome: item.nome, grupo: item.grupo, veredito: '', detalhe: '' };
  try {
    const m = await pedirComRetentativa(item.url, { timeout: 45000 });
    res.manifestoMs = m.ttfb;
    if (m.status !== 200) { res.veredito = 'FORA_DO_AR'; res.detalhe = 'manifesto HTTP ' + m.status; return res; }
    if (ehHtml(m.corpo, m.headers.get('content-type'))) {
      const t = /<title>([^<]{0,60})/i.exec(m.corpo.toString('latin1'));
      res.veredito = 'FORA_DO_AR'; res.detalhe = 'o provedor devolveu uma página HTML' + (t ? ' (' + t[1].trim() + ')' : ''); return res;
    }
    if (m.corpo[0] === 0x47) { res.veredito = 'TS_DIRETO'; res.detalhe = 'MPEG-TS contínuo (sem HLS): o app toca por mpegts.js, não foi medido aqui'; return res; }
    let txt = m.corpo.toString('utf8');
    if (!txt.startsWith('#EXTM3U')) { res.veredito = 'FORMATO_INESPERADO'; res.detalhe = 'não é M3U8 nem TS'; return res; }
    let base = m.urlFinal || item.url;
    let bwNivel = 0;
    if (/#EXT-X-STREAM-INF/.test(txt)) {
      const ls = txt.split(/\r?\n/);
      const niveis = [];
      ls.forEach((l, i) => { if (l.startsWith('#EXT-X-STREAM-INF')) niveis.push({ bw: +(/BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0, rs: (/RESOLUTION=([\dx]+)/.exec(l) || [])[1] || '', u: abs(base, ls[i + 1]) }); });
      niveis.sort((a, b) => b.bw - a.bw);
      res.qualidades = niveis.map((n) => (n.rs || '?') + '@' + Math.round(n.bw / 1000) + 'k').join(' ');
      bwNivel = niveis[0].bw;
      const m2 = await pedirComRetentativa(niveis[0].u, { timeout: 45000 });
      if (m2.status !== 200) { res.veredito = 'FORA_DO_AR'; res.detalhe = 'lista de qualidade HTTP ' + m2.status; return res; }
      txt = m2.corpo.toString('utf8');
      base = m2.urlFinal || niveis[0].u;
      res.manifestoMs = Math.max(res.manifestoMs, m2.ttfb);
    }
    const ls = txt.split(/\r?\n/);
    const durs = ls.filter((l) => l.startsWith('#EXTINF')).map((l) => parseFloat(l.slice(8)) || 0);
    const segs = ls.filter((l) => l && !l.startsWith('#')).map((l) => abs(base, l));
    res.janela = segs.length;
    if (!segs.length) { res.veredito = 'SEM_TRECHOS'; res.detalhe = 'manifesto sem nenhum trecho'; return res; }
    const dur = durs[segs.length - 1] || durs[0] || 6;
    res.trechoSeg = Math.round(dur * 10) / 10;
    const t = await pedir(segs[segs.length - 1], { timeout: 40000, limite: opt.profundo ? 0 : 700000 });
    if (t.status !== 200) { res.veredito = 'FORA_DO_AR'; res.detalhe = 'trecho HTTP ' + t.status; return res; }
    if (!t.corpo.length || t.corpo[0] !== 0x47) { res.veredito = 'FORA_DO_AR'; res.detalhe = ehHtml(t.corpo, t.headers.get('content-type')) ? 'o trecho é uma página HTML' : 'o trecho não é vídeo MPEG-TS'; return res; }
    const kbps = Math.round((t.corpo.length * 8) / Math.max(1, t.ms - t.ttfb));
    res.baixaKbps = kbps;
    const bitrate = bwNivel ? bwNivel / 1000 : opt.profundo ? (t.corpo.length * 8) / dur / 1000 : 0;
    res.bitrateKbps = Math.round(bitrate);
    if (bitrate) res.velocidadeX = Math.round((kbps / bitrate) * 10) / 10;
    const fluxos = fluxosTs(t.corpo);
    res.fluxos = fluxos.join('+');
    const av = avaliarCodecs(fluxos);
    if (av.ruins.length) { res.veredito = 'CODEC_INCOMPATIVEL'; res.detalhe = av.ruins.join('; '); return res; }
    if (!av.video.length && av.audio.length) { res.veredito = 'SO_AUDIO'; res.detalhe = 'só áudio (rádio)'; return res; }
    if (!av.video.length) { res.veredito = 'SEM_VIDEO'; res.detalhe = 'o trecho não tem vídeo (' + (res.fluxos || 'nenhum fluxo') + ')'; return res; }
    if (res.velocidadeX && res.velocidadeX < 1.5) { res.veredito = 'LENTO'; res.detalhe = 'baixa a ' + res.velocidadeX + 'x o tempo real (precisa de mais de 1,5x)'; return res; }
    if (res.janela < 2) { res.veredito = 'FRIO'; res.detalhe = 'janela de 1 trecho: vai parar a cada trecho'; return res; }
    if (res.manifestoMs > 10000) { res.veredito = 'FRIO'; res.detalhe = 'o manifesto levou ' + Math.round(res.manifestoMs / 1000) + ' s (canal "frio", abre devagar)'; return res; }
    res.veredito = 'OK';
    return res;
  } catch (e) {
    res.veredito = 'FORA_DO_AR';
    res.detalhe = String((e && e.name === 'TimeoutError') ? 'tempo esgotado' : (e && e.message) || e).slice(0, 80);
    return res;
  }
}

// ───────────── filmes e episódios: verificação de um arquivo ─────────────
const FORMATOS = { mp4: 'bom', m4v: 'bom', webm: 'bom', mkv: 'depende', mov: 'depende', avi: 'ruim', wmv: 'ruim', flv: 'ruim', ts: 'depende', mpg: 'ruim', mpeg: 'ruim', '3gp': 'ruim' };
function assinatura(b) {
  if (b.length >= 8 && b.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv/webm';
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF') return 'avi';
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return 'ts';
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === 'FLV\u0001') return 'flv';
  if (b.length >= 4 && b.readUInt32BE(0) === 0x3026b275) return 'wmv';
  return '';
}
async function verificarArquivo(item, tipo) {
  const res = { tipo, nome: item.nome, grupo: item.grupo, veredito: '', detalhe: '' };
  const ext = (/\.([a-z0-9]{2,4})(\?|$)/i.exec(new URL(item.url).pathname) || [])[1] || '';
  res.extensao = ext.toLowerCase();
  try {
    const r = await pedirComRetentativa(item.url, { timeout: 30000, range: 'bytes=0-8191', limite: 8192 });
    res.respostaMs = r.ttfb;
    if (r.status === 404) { res.veredito = 'NAO_EXISTE'; res.detalhe = 'HTTP 404'; return res; }
    if (r.status === 401 || r.status === 403 || r.status === 429) { res.veredito = 'BLOQUEADO'; res.detalhe = 'HTTP ' + r.status + ' (acesso/limite do provedor)'; return res; }
    if (r.status !== 200 && r.status !== 206) { res.veredito = 'FORA_DO_AR'; res.detalhe = 'HTTP ' + r.status; return res; }
    const ct = r.headers.get('content-type') || '';
    if (ehHtml(r.corpo, ct)) { res.veredito = 'FORA_DO_AR'; res.detalhe = 'o provedor devolveu uma página HTML'; return res; }
    res.aceitaRange = r.status === 206;
    const cr = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    const tam = cr ? Number(cr[1]) : Number(r.headers.get('content-length') || 0);
    res.tamanhoMB = tam ? Math.round(tam / 1048576) : null;
    if (tam && tam < 5 * 1048576) { res.veredito = 'ARQUIVO_PEQUENO'; res.detalhe = 'só ' + Math.round(tam / 1024) + ' KB (provável arquivo vazio/falso)'; return res; }
    const sig = assinatura(r.corpo);
    res.assinatura = sig;
    if (!sig) { res.veredito = 'NAO_E_VIDEO'; res.detalhe = 'os primeiros bytes não são de um vídeo conhecido (' + (ct || 'sem content-type') + ')'; return res; }
    const qual = FORMATOS[res.extensao] || 'depende';
    if (qual === 'ruim' || sig === 'avi' || sig === 'flv' || sig === 'wmv') { res.veredito = 'FORMATO_NAO_TOCA'; res.detalhe = 'formato ' + (res.extensao || sig) + ' (navegadores não tocam)'; return res; }
    if (!res.aceitaRange) { res.veredito = 'SEM_RANGE'; res.detalhe = 'responde, mas não aceita avançar/voltar (sem Range)'; return res; }
    res.veredito = qual === 'depende' ? 'OK_MKV' : 'OK';
    if (qual === 'depende') res.detalhe = 'formato ' + res.extensao + ': toca no Chrome/Edge se o codec for H.264/AAC; no Safari/iPhone costuma falhar';
    return res;
  } catch (e) {
    res.veredito = 'FORA_DO_AR';
    res.detalhe = String((e && e.name === 'TimeoutError') ? 'tempo esgotado' : (e && e.message) || e).slice(0, 80);
    return res;
  }
}

// ───────────── séries: agrupar episódios ─────────────
const RE_EP = /^(.*?)[\s._\-–]*S\s?(\d{1,3})\s?[Ee×x]\s?(\d{1,4})/;
function agruparSeries(itens) {
  const mapa = new Map();
  const soltos = [];
  for (const it of itens) {
    const m = RE_EP.exec(it.nome);
    if (!m || !m[1].trim()) { soltos.push(it); continue; }
    const chave = (it.grupo + '|' + m[1].trim()).toLowerCase();
    if (!mapa.has(chave)) mapa.set(chave, { nome: m[1].trim(), grupo: it.grupo, episodios: [] });
    mapa.get(chave).episodios.push({ ...it, temporada: Number(m[2]), episodio: Number(m[3]) });
  }
  for (const s of mapa.values()) s.episodios.sort((a, b) => a.temporada - b.temporada || a.episodio - b.episodio);
  return { series: [...mapa.values()], soltos };
}

// ───────────── execução com fila, retomada e aviso de bloqueio ─────────────
async function executar(trabalhos, fazer, arquivoJsonl, chave) {
  const feitos = new Map();
  if (opt.retomar && existsSync(arquivoJsonl)) {
    for (const l of readFileSync(arquivoJsonl, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); feitos.set(r.chave, r); } catch (e) { /* linha quebrada */ }
    }
  }
  const saida = createWriteStream(arquivoJsonl, { flags: opt.retomar ? 'a' : 'w' });
  const pendentes = trabalhos.filter((t) => !feitos.has(chave(t)));
  const todos = [...feitos.values()];
  let i = 0, concluidos = 0, seguidosBloqueio = 0, parar = false;
  const t0 = Date.now();
  console.error(`[verificar] ${trabalhos.length} itens (${feitos.size} já feitos, ${pendentes.length} a verificar), ${opt.concorrencia} em paralelo.`);
  async function trabalhador() {
    while (!parar) {
      const idx = i++;
      if (idx >= pendentes.length) return;
      const t = pendentes[idx];
      const r = await fazer(t);
      r.chave = chave(t);
      todos.push(r);
      saida.write(JSON.stringify(r) + '\n');
      concluidos++;
      if (r.veredito === 'BLOQUEADO') seguidosBloqueio++; else seguidosBloqueio = 0;
      if (seguidosBloqueio >= 20) { parar = true; console.error('[verificar] PAROU: 20 respostas 401/403/429 seguidas. O provedor pode estar bloqueando a conta; espere um tempo e rode de novo com --retomar e --concorrencia 1.'); }
      if (concluidos % 25 === 0 || concluidos === pendentes.length) {
        const ok = todos.filter((x) => /^OK/.test(x.veredito)).length;
        const seg = (Date.now() - t0) / 1000;
        const falta = pendentes.length - concluidos;
        console.error(`[verificar] ${concluidos}/${pendentes.length} · funcionam ${ok}/${todos.length} · faltam ~${Math.round((falta * seg) / Math.max(1, concluidos) / 60)} min`);
      }
      if (opt.pausa) await dormir(opt.pausa);
    }
  }
  await Promise.all(Array.from({ length: opt.concorrencia }, trabalhador));
  await new Promise((r) => saida.end(r));
  return todos;
}

// ───────────── relatórios ─────────────
const csv = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
function gravarRelatorios(pasta, titulo, resultados, ok, frios, m3uDe) {
  const contagem = {};
  for (const r of resultados) contagem[r.veredito] = (contagem[r.veredito] || 0) + 1;
  const linhasCsv = ['nome,grupo,veredito,detalhe'];
  const aprovados = new Set([...ok, ...frios].map((x) => x.chave));
  for (const r of resultados.filter((x) => !aprovados.has(x.chave))) linhasCsv.push([r.nome, r.grupo, r.veredito, r.detalhe].map(csv).join(','));
  writeFileSync(join(pasta, 'falhas.csv'), '﻿' + linhasCsv.join('\n'), 'utf8');
  writeFileSync(join(pasta, 'ok.m3u'), m3uDe(ok), 'utf8');
  writeFileSync(join(pasta, 'ok-ressalvas.m3u'), m3uDe(frios), 'utf8');
  const total = resultados.length;
  const md = [
    `# ${titulo}`, '',
    `Verificados: **${total}** · funcionam (ok.m3u): **${ok.length}** (${total ? Math.round((ok.length * 100) / total) : 0}%)` + ` · funcionam com ressalva (ok-ressalvas.m3u): **${frios.length}**`, '',
    '| Veredito | Quantidade |', '|---|---|',
    ...Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '',
    'Arquivos: `resultados.jsonl` (tudo, uma linha por item), `falhas.csv` (o que não funciona e por quê), `ok.m3u` (lista só com o que funciona).',
    'Os relatórios não têm usuário nem senha; os arquivos `.m3u` têm as URLs reais: trate como segredo.', '',
  ];
  writeFileSync(join(pasta, 'resumo.md'), md.join('\n'), 'utf8');
  writeFileSync(join(pasta, 'resumo.json'), JSON.stringify({ titulo, total, funcionam: ok.length, ressalvas: frios.length, contagem }, null, 2), 'utf8');
  console.error('\n' + md.slice(0, 4).join('\n'));
  for (const [k, v] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) console.error(`  ${k}: ${v}`);
}

// ───────────── principal ─────────────
const itensLista = await lerLista(fonte);
const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const pasta = opt.saida || join('resultado-listas', `${modo}-${opt.retomar ? 'retomada' : carimbo}`);
mkdirSync(pasta, { recursive: true });
console.error(`[verificar] lista lida: ${itensLista.length} entradas. Resultados em ${pasta}`);

let candidatos = itensLista;
if (modo === 'canais') candidatos = itensLista.filter((i) => !/\/(movie|series)\//i.test(i.url));
if (modo === 'filmes') candidatos = itensLista.filter((i) => /\/movie\//i.test(i.url));
if (modo === 'series') candidatos = itensLista.filter((i) => /\/series\//i.test(i.url));
if (opt.filtro) candidatos = candidatos.filter((i) => (i.nome + ' ' + i.grupo).toLowerCase().includes(opt.filtro));

if (modo === 'canais' || modo === 'filmes') {
  let alvo = candidatos;
  if (opt.amostra) { const passo = Math.max(1, Math.floor(alvo.length / opt.amostra)); alvo = alvo.filter((_, i) => i % passo === 0).slice(0, opt.amostra); }
  const porChave = new Map(alvo.map((i) => [mascara(i.url) + '#' + i.nome + '#' + i.url.length + '#' + i.url.slice(-14), i]));
  const chave = (i) => mascara(i.url) + '#' + i.nome + '#' + i.url.length + '#' + i.url.slice(-14);
  const resultados = await executar(alvo, (i) => (modo === 'canais' ? verificarCanal(i) : verificarArquivo(i, 'filme')), join(pasta, 'resultados.jsonl'), chave);
  const bons = modo === 'canais' ? ['OK', 'TS_DIRETO', 'SO_AUDIO'] : ['OK'];
  const ressalvas = modo === 'canais' ? ['FRIO'] : ['OK_MKV'];
  const m3uItens = (lista) => '#EXTM3U\n' + lista.map((r) => porChave.get(r.chave)).filter(Boolean).map((i) => i.extinf + '\n' + i.url).join('\n') + '\n';
  gravarRelatorios(pasta, modo === 'canais' ? 'Canais ao vivo' : 'Filmes', resultados, resultados.filter((r) => bons.includes(r.veredito)), resultados.filter((r) => ressalvas.includes(r.veredito)), m3uItens);
} else {
  const { series, soltos } = agruparSeries(candidatos);
  let alvo = series;
  if (opt.amostra) { const passo = Math.max(1, Math.floor(alvo.length / opt.amostra)); alvo = alvo.filter((_, i) => i % passo === 0).slice(0, opt.amostra); }
  console.error(`[verificar] ${series.length} séries (${candidatos.length - soltos.length} episódios)` + (soltos.length ? ` + ${soltos.length} entradas sem "S01E01" no nome (ignoradas)` : '') + `; episódios: ${opt.episodios === 'todos' ? 'todos' : 'só o primeiro de cada série'}.`);
  const chave = (s) => (s.grupo + '|' + s.nome).toLowerCase();
  const porChave = new Map();
  const fazer = async (s) => {
    const eps = opt.episodios === 'todos' ? s.episodios : s.episodios.slice(0, 1);
    const detalhes = [];
    for (const ep of eps) {
      const r = await verificarArquivo(ep, 'episodio');
      detalhes.push({ t: ep.temporada, e: ep.episodio, veredito: r.veredito, detalhe: r.detalhe });
      if (opt.pausa) await dormir(opt.pausa);
    }
    const boas = detalhes.filter((d) => d.veredito === 'OK').length;
    const mkv = detalhes.filter((d) => d.veredito === 'OK_MKV').length;
    const res = { tipo: 'serie', nome: s.nome, grupo: s.grupo, episodios: s.episodios.length, testados: detalhes.length, boas, mkv, veredito: '', detalhe: '' };
    if (boas === detalhes.length) res.veredito = 'OK';
    else if (boas + mkv === detalhes.length) res.veredito = 'OK_MKV';
    else if (boas + mkv > 0) { res.veredito = 'PARCIAL'; res.detalhe = (detalhes.length - boas - mkv) + ' de ' + detalhes.length + ' episódios testados falharam: ' + [...new Set(detalhes.filter((d) => !/^OK/.test(d.veredito)).map((d) => d.veredito))].join(', '); }
    else { res.veredito = detalhes[0] ? detalhes[0].veredito : 'FORA_DO_AR'; res.detalhe = detalhes[0] ? detalhes[0].detalhe : ''; }
    // lista final: os episódios da série (todos, se a série foi aprovada)
    porChave.set(chave(s), s);
    return res;
  };
  const resultados = await executar(alvo, fazer, join(pasta, 'resultados.jsonl'), chave);
  // ok.m3u das séries: todos os episódios das séries aprovadas
  const mapaSeries = new Map(series.map((x) => [chave(x), x]));
  const m3uSeries = (lista) => '#EXTM3U\n' + lista.flatMap((r) => (mapaSeries.get(r.chave) ? mapaSeries.get(r.chave).episodios.map((e) => e.extinf + '\n' + e.url) : [])).join('\n') + '\n';
  gravarRelatorios(pasta, 'Séries', resultados, resultados.filter((r) => r.veredito === 'OK'), resultados.filter((r) => ['OK_MKV', 'PARCIAL'].includes(r.veredito)), m3uSeries);
}
console.error(`\n[verificar] pronto. Veja ${join(pasta, 'resumo.md')}.`);
