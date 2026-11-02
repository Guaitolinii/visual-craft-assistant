// scripts/monitor-canais/lib.mjs
// Funções puras e sonda para o monitor de canais de IPTV

/**
 * Faz o parse de uma lista M3U em texto e extrai canais válidos.
 * Ignora linhas sem URL e URLs que não comecem com http:// ou https://.
 *
 * @param {string} texto - Conteúdo completo do arquivo M3U.
 * @returns {Array<{ nome: string, grupo: string, url: string }>}
 */
export function parseM3u(texto) {
  if (typeof texto !== "string" || !texto.trim()) {
    return [];
  }

  const linhas = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const canais = [];

  let infoPendente = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;

    if (linha.startsWith("#EXTINF:")) {
      // Extrai grupo de group-title="..." ou group-title='...'
      let grupo = "";
      const matchGrupo = linha.match(/group-title=(?:"([^"]*)"|'([^']*)')/i);
      if (matchGrupo) {
        grupo = matchGrupo[1] !== undefined ? matchGrupo[1] : matchGrupo[2];
      }

      // Nome é o texto após a última vírgula da linha EXTINF
      const ultimaVirgula = linha.lastIndexOf(",");
      let nome = "";
      if (ultimaVirgula !== -1) {
        nome = linha.slice(ultimaVirgula + 1).trim();
      }

      infoPendente = { nome, grupo };
      continue;
    }

    if (linha.startsWith("#")) {
      // Outro comentário ou diretiva ignorada
      continue;
    }

    // Linha de URL
    if (infoPendente) {
      if (linha.startsWith("http://") || linha.startsWith("https://")) {
        canais.push({
          nome: infoPendente.nome,
          grupo: infoPendente.grupo,
          url: linha,
        });
      }
      infoPendente = null;
    }
  }

  return canais;
}

/**
 * Lê o valor de uma chave em formato .env.
 * Lança erro se a chave não existir ou tiver valor vazio.
 * Nunca inclui o valor na mensagem de erro.
 *
 * @param {string} textoEnv - Conteúdo do arquivo de ambiente.
 * @param {string} chave - Nome da variável desejada.
 * @returns {string}
 */
export function lerChaveEnv(textoEnv, chave) {
  if (typeof textoEnv !== "string") {
    throw new Error(`chave ${chave} ausente no arquivo de ambiente`);
  }

  const linhas = textoEnv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const linha of linhas) {
    const trim = linha.trim();
    if (!trim || trim.startsWith("#")) continue;

    const idxIgual = trim.indexOf("=");
    if (idxIgual === -1) continue;

    const k = trim.slice(0, idxIgual).trim();
    if (k === chave) {
      let v = trim.slice(idxIgual + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!v) {
        throw new Error(`chave ${chave} ausente no arquivo de ambiente`);
      }
      return v;
    }
  }

  throw new Error(`chave ${chave} ausente no arquivo de ambiente`);
}

/**
 * Normaliza o nome do canal para identificar sua família (ex: "espn 2").
 * Remove termos de qualidade/resolução (fhd, hd, sd, 4k) e normaliza espaços.
 *
 * @param {string} nome
 * @returns {string}
 */
export function familiaDoCanal(nome) {
  if (typeof nome !== "string") return "";

  return nome
    .toLowerCase()
    .replace(/\b(fhd|hd|sd|4k)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filtra canais por grupos permitidos, termos excluídos e termos incluídos no nome.
 *
 * @param {Array<{ nome: string, grupo: string, url: string }>} canais
 * @param {{ grupos?: string[], excluir?: string[], incluir?: string[] }} filtros
 * @returns {Array<{ nome: string, grupo: string, url: string }>}
 */
export function filtrarCanais(canais, { grupos, excluir, incluir } = {}) {
  if (!Array.isArray(grupos) || grupos.length === 0 || !Array.isArray(canais)) {
    return [];
  }

  const gruposLower = grupos.map((g) => g.toLowerCase().trim()).filter(Boolean);
  if (gruposLower.length === 0) return [];

  const todosGrupos = gruposLower.includes("*");

  const excluirLower = Array.isArray(excluir)
    ? excluir.map((e) => e.toLowerCase().trim()).filter(Boolean)
    : [];

  const incluirLower = Array.isArray(incluir)
    ? incluir.map((i) => i.toLowerCase().trim()).filter(Boolean)
    : [];

  return canais.filter((canal) => {
    const canalGrupo = (canal.grupo || "").toLowerCase();
    const passouGrupo = todosGrupos || gruposLower.some((g) => canalGrupo.includes(g));
    if (!passouGrupo) return false;

    const canalNome = (canal.nome || "").toLowerCase();

    if (incluirLower.length > 0) {
      const incluiu = incluirLower.some((inc) => canalNome.includes(inc));
      if (!incluiu) return false;
    }

    if (excluirLower.length > 0) {
      const excluido = excluirLower.some((e) => canalNome.includes(e));
      if (excluido) return false;
    }

    return true;
  });
}

/**
 * Identifica o tipo de stream a partir dos primeiros bytes do corpo.
 *
 * @param {Buffer} buffer - Primeiros bytes recebidos.
 * @returns {"ts" | "hls" | "html" | "vazio" | "outro"}
 */
function identificarTipo(buffer) {
  if (!buffer || buffer.length === 0) {
    return "vazio";
  }

  // MPEG-TS: byte 0x47 nas posições p, p+188 e p+376 para algum p < 188
  for (let p = 0; p < 188; p++) {
    if (
      p + 376 < buffer.length &&
      buffer[p] === 0x47 &&
      buffer[p + 188] === 0x47 &&
      buffer[p + 376] === 0x47
    ) {
      return "ts";
    }
  }

  const inicioTexto = buffer.subarray(0, 512).toString("utf-8");
  if (inicioTexto.startsWith("#EXTM3U")) {
    return "hls";
  }

  if (inicioTexto.trimStart().startsWith("<")) {
    return "html";
  }

  return "outro";
}

/**
 * Extrai a URI da primeira variante de um manifesto mestre HLS.
 *
 * @param {string} texto
 * @returns {string | null}
 */
function extrairPrimeiraVarianteHls(texto) {
  const linhas = texto.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (linha.startsWith("#EXT-X-STREAM-INF")) {
      for (let j = i + 1; j < linhas.length; j++) {
        const prox = linhas[j].trim();
        if (prox && !prox.startsWith("#")) {
          return prox;
        }
      }
    }
  }
  return null;
}

/**
 * Faz o parse de uma lista de mídia HLS extraindo TARGETDURATION, MEDIA-SEQUENCE,
 * ENDLIST, KEY e segmentos com suas durações e URIs.
 *
 * @param {string} texto
 * @returns {{
 *   targetDuration: number | null,
 *   mediaSequence: number,
 *   isVod: boolean,
 *   isEncrypted: boolean,
 *   segmentos: Array<{ duracao: number, uri: string }>
 * }}
 */
function parseMediaPlaylistHls(texto) {
  let targetDuration = null;
  let mediaSequence = 0;
  let isVod = false;
  let isEncrypted = false;
  const segmentos = [];

  const linhas = texto.split(/\r?\n/);
  let duracaoPendente = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;

    if (linha.startsWith("#EXT-X-TARGETDURATION:")) {
      const val = parseFloat(linha.slice("#EXT-X-TARGETDURATION:".length).trim());
      if (!isNaN(val)) targetDuration = val;
    } else if (linha.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const val = parseInt(linha.slice("#EXT-X-MEDIA-SEQUENCE:".length).trim(), 10);
      if (!isNaN(val)) mediaSequence = val;
    } else if (linha.startsWith("#EXT-X-ENDLIST")) {
      isVod = true;
    } else if (linha.startsWith("#EXT-X-KEY:")) {
      const match = linha.match(/METHOD=([^,\s]+)/);
      if (match && match[1].toUpperCase() !== "NONE") {
        isEncrypted = true;
      }
    } else if (linha.startsWith("#EXTINF:")) {
      const resto = linha.slice("#EXTINF:".length).trim();
      const durMatch = resto.match(/^([0-9.]+)/);
      if (durMatch) {
        duracaoPendente = parseFloat(durMatch[1]);
      }
    } else if (!linha.startsWith("#")) {
      if (duracaoPendente !== null) {
        segmentos.push({
          duracao: duracaoPendente,
          uri: linha,
        });
        duracaoPendente = null;
      }
    }
  }

  return {
    targetDuration,
    mediaSequence,
    isVod,
    isEncrypted,
    segmentos,
  };
}

/**
 * Baixa um manifesto ou lista HLS seguindo redirecionamentos manualmente.
 *
 * @param {string} urlInicial
 * @param {{ maxSaltos?: number, timeoutMs?: number }} opcoes
 * @returns {Promise<{
 *   ok: boolean,
 *   http: number,
 *   texto?: string,
 *   urlFinal: string,
 *   hostFinal: string,
 *   saltos: number,
 *   erro?: string
 * }>}
 */
async function baixarTextoComRedirecionamento(urlInicial, { maxSaltos = 6, timeoutMs = 10000 } = {}) {
  let curUrl = urlInicial;
  let saltos = 0;
  let hostFinal = "";

  try {
    hostFinal = new URL(urlInicial).host;
  } catch {
    return { ok: false, http: 0, erro: "url-invalida", saltos: 0, hostFinal: "", urlFinal: curUrl };
  }

  while (saltos <= maxSaltos) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(curUrl, {
        redirect: "manual",
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const erro = ctrl.signal.aborted ? "timeout" : "conexao";
      return { ok: false, http: 0, erro, saltos, hostFinal, urlFinal: curUrl };
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      saltos++;
      if (saltos > maxSaltos) {
        return { ok: false, http: res.status, erro: "muitos-saltos", saltos: maxSaltos, hostFinal, urlFinal: curUrl };
      }
      const loc = res.headers.get("location");
      if (!loc) {
        return { ok: false, http: res.status, erro: "conexao", saltos, hostFinal, urlFinal: curUrl };
      }
      try {
        curUrl = new URL(loc, curUrl).href;
        hostFinal = new URL(curUrl).host;
      } catch {
        return { ok: false, http: res.status, erro: "url-invalida", saltos, hostFinal, urlFinal: curUrl };
      }
      continue;
    }

    if (res.status !== 200) {
      return { ok: false, http: res.status, erro: `playlist-http-${res.status}`, saltos, hostFinal, urlFinal: curUrl };
    }

    let texto = "";
    try {
      texto = await res.text();
    } catch (err) {
      return { ok: false, http: res.status, erro: "conexao", saltos, hostFinal, urlFinal: curUrl };
    }

    return { ok: true, http: res.status, texto, saltos, hostFinal, urlFinal: curUrl };
  }

  return { ok: false, http: 0, erro: "muitos-saltos", saltos, hostFinal, urlFinal: curUrl };
}

/**
 * Sonda uma URL seguindo redirecionamentos manualmente e lendo até leituraMs.
 * Nunca lança exceção e nunca expõe a URL na mensagem de erro.
 *
 * @param {string} url - URL do canal a ser sondado.
 * @param {{ leituraMs: number, conexaoMs?: number, maxSaltos?: number }} opcoes
 * @returns {Promise<{
 *   http: number,
 *   saltos: number,
 *   hostFinal: string,
 *   ttfbMs: number | null,
 *   bytes: number,
 *   kbps: number,
 *   paradas: number,
 *   maiorLacunaMs: number,
 *   tipo: "ts" | "hls" | "html" | "vazio" | "outro",
 *   erro: string | null
 * }>}
 */
export function sondar(url, { leituraMs, conexaoMs = 10000, maxSaltos = 6 } = {}) {
  return new Promise(async (resolve) => {
    let currentUrl = url;
    let saltos = 0;
    let hostFinal = "";

    try {
      hostFinal = new URL(url).host;
    } catch {
      return resolve({
        http: 0,
        saltos: 0,
        hostFinal: "",
        ttfbMs: null,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: 0,
        tipo: "vazio",
        erro: "url-invalida",
      });
    }

    let response = null;

    // Loop de redirecionamentos manuais
    while (saltos <= maxSaltos) {
      const connectCtrl = new AbortController();
      const connectTimeout = setTimeout(() => connectCtrl.abort(), conexaoMs);

      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: connectCtrl.signal,
        });
      } catch (err) {
        clearTimeout(connectTimeout);
        const erroTipo = connectCtrl.signal.aborted ? "timeout" : "conexao";
        return resolve({
          http: 0,
          saltos,
          hostFinal,
          ttfbMs: null,
          bytes: 0,
          kbps: 0,
          paradas: 0,
          maiorLacunaMs: 0,
          tipo: "vazio",
          erro: erroTipo,
        });
      } finally {
        clearTimeout(connectTimeout);
      }

      // Verifica status de redirecionamento HTTP
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        saltos++;
        if (saltos > maxSaltos) {
          return resolve({
            http: response.status,
            saltos: maxSaltos,
            hostFinal,
            ttfbMs: null,
            bytes: 0,
            kbps: 0,
            paradas: 0,
            maiorLacunaMs: 0,
            tipo: "vazio",
            erro: "muitos-saltos",
          });
        }

        const loc = response.headers.get("location");
        if (!loc) {
          return resolve({
            http: response.status,
            saltos,
            hostFinal,
            ttfbMs: null,
            bytes: 0,
            kbps: 0,
            paradas: 0,
            maiorLacunaMs: 0,
            tipo: "vazio",
            erro: "conexao",
          });
        }

        try {
          currentUrl = new URL(loc, currentUrl).href;
          hostFinal = new URL(currentUrl).host;
        } catch {
          return resolve({
            http: response.status,
            saltos,
            hostFinal,
            ttfbMs: null,
            bytes: 0,
            kbps: 0,
            paradas: 0,
            maiorLacunaMs: 0,
            tipo: "vazio",
            erro: "url-invalida",
          });
        }

        continue;
      }

      // Não é redirecionamento: obtivemos a resposta final
      break;
    }

    const http = response.status;
    const tempoInicio = Date.now();
    let tempoPrimeiroByte = null;
    let ttfbMs = null;
    let totalBytes = 0;
    let paradas = 0;
    let maiorLacunaMs = 0;
    let ultimoChunkTempo = null;
    const maxBytes = 4 * 1024 * 1024; // 4 MB
    const chunkBuffer = [];
    let chunkBufferLength = 0;
    let erroLeitura = null;

    if (!response.body) {
      return resolve({
        http,
        saltos,
        hostFinal,
        ttfbMs: null,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: 0,
        tipo: "vazio",
        erro: null,
      });
    }

    const reader = response.body.getReader();
    let leituraConcluida = false;

    const leituraTimer = setTimeout(async () => {
      if (!leituraConcluida) {
        leituraConcluida = true;
        try {
          await reader.cancel();
        } catch {}
      }
    }, leituraMs);

    try {
      while (!leituraConcluida) {
        const { done, value } = await reader.read();
        const agora = Date.now();

        if (done) {
          break;
        }

        if (value && value.length > 0) {
          if (tempoPrimeiroByte === null) {
            tempoPrimeiroByte = agora;
            ttfbMs = agora - tempoInicio;
            ultimoChunkTempo = agora;
          } else {
            const gap = agora - ultimoChunkTempo;
            if (gap >= 2000) {
              paradas++;
            }
            if (gap > maiorLacunaMs) {
              maiorLacunaMs = gap;
            }
            ultimoChunkTempo = agora;
          }

          totalBytes += value.length;
          if (chunkBufferLength < 1048576) {
            chunkBuffer.push(Buffer.from(value));
            chunkBufferLength += value.length;
          }

          if (totalBytes >= maxBytes) {
            leituraConcluida = true;
            try {
              await reader.cancel();
            } catch {}
            break;
          }
        }
      }
    } catch (err) {
      if (!leituraConcluida) {
        erroLeitura = "conexao";
      }
    } finally {
      clearTimeout(leituraTimer);
      leituraConcluida = true;
    }

    const fim = Date.now();
    if (ultimoChunkTempo !== null) {
      const gapFim = fim - ultimoChunkTempo;
      if (gapFim > maiorLacunaMs) {
        maiorLacunaMs = gapFim;
      }
    }

    let kbps = 0;
    if (totalBytes > 0 && tempoPrimeiroByte !== null) {
      const tempoLeituraS = (fim - tempoPrimeiroByte) / 1000;
      if (tempoLeituraS >= 0.2) {
        kbps = Math.round((totalBytes * 8) / tempoLeituraS / 1000);
      }
    }

    const bufCabecalho = Buffer.concat(chunkBuffer);
    const tipo = identificarTipo(bufCabecalho);

    if (tipo !== "hls") {
      return resolve({
        http,
        saltos,
        hostFinal,
        ttfbMs,
        bytes: totalBytes,
        kbps,
        paradas,
        maiorLacunaMs,
        tipo,
        erro: erroLeitura,
      });
    }

    if (http !== 200) {
      return resolve({
        http,
        saltos,
        hostFinal,
        ttfbMs,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: 0,
        tipo: "hls",
        segmentos: 0,
        erro: erroLeitura,
      });
    }

    const prazoFinal = tempoInicio + (typeof leituraMs === "number" ? leituraMs : conexaoMs);
    let manifestTexto = Buffer.concat(chunkBuffer).toString("utf-8");
    let mediaPlaylistTexto = manifestTexto;
    let mediaPlaylistUrl = currentUrl;
    let tempoPrimeiroDownloadMediaPlaylist = tempoInicio;
    let saltosAcumulados = saltos;

    // 1. Se o manifesto for mestre, baixar a primeira variante
    if (manifestTexto.includes("#EXT-X-STREAM-INF")) {
      const varUri = extrairPrimeiraVarianteHls(manifestTexto);
      if (!varUri) {
        return resolve({
          http,
          saltos: saltosAcumulados,
          hostFinal,
          ttfbMs,
          bytes: 0,
          kbps: 0,
          paradas: 0,
          maiorLacunaMs: 0,
          tipo: "hls",
          segmentos: 0,
          erro: "playlist-vazia",
        });
      }

      let varUrl;
      try {
        varUrl = new URL(varUri, currentUrl).href;
      } catch {
        return resolve({
          http,
          saltos: saltosAcumulados,
          hostFinal,
          ttfbMs,
          bytes: 0,
          kbps: 0,
          paradas: 0,
          maiorLacunaMs: 0,
          tipo: "hls",
          segmentos: 0,
          erro: "url-invalida",
        });
      }

      const tempoSobraMedia = Math.max(100, prazoFinal - Date.now());
      const resMedia = await baixarTextoComRedirecionamento(varUrl, {
        maxSaltos,
        timeoutMs: Math.min(conexaoMs, tempoSobraMedia),
      });

      saltosAcumulados += resMedia.saltos || 0;
      if (resMedia.hostFinal) hostFinal = resMedia.hostFinal;

      if (!resMedia.ok) {
        return resolve({
          http,
          saltos: saltosAcumulados,
          hostFinal,
          ttfbMs,
          bytes: 0,
          kbps: 0,
          paradas: 0,
          maiorLacunaMs: 0,
          tipo: "hls",
          segmentos: 0,
          erro: resMedia.erro,
        });
      }

      mediaPlaylistTexto = resMedia.texto;
      mediaPlaylistUrl = resMedia.urlFinal;
      tempoPrimeiroDownloadMediaPlaylist = Date.now();
    }

    // 2 e 3. Parse da lista de mídia
    const playlist = parseMediaPlaylistHls(mediaPlaylistTexto);
    if (!playlist.segmentos || playlist.segmentos.length === 0) {
      return resolve({
        http,
        saltos: saltosAcumulados,
        hostFinal,
        ttfbMs,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: 0,
        tipo: "hls",
        segmentos: 0,
        erro: "playlist-vazia",
      });
    }

    // 4. Baixar os últimos N segmentos em sequência
    const n = Math.min(3, playlist.segmentos.length);
    const segmentosParaBaixar = playlist.segmentos.slice(-n);
    const segmentosBaixados = [];
    let erroSegmento = null;

    for (let i = 0; i < segmentosParaBaixar.length; i++) {
      const segInfo = segmentosParaBaixar[i];
      const agora = Date.now();
      const tempoRestante = prazoFinal - agora;

      if (i > 0 && tempoRestante <= 0) {
        break;
      }

      const timeoutMs = i === 0
        ? (tempoRestante > 0 ? Math.min(15000, tempoRestante) : 15000)
        : Math.min(15000, tempoRestante);

      let segUrl;
      try {
        segUrl = new URL(segInfo.uri, mediaPlaylistUrl).href;
      } catch {
        erroSegmento = "url-invalida";
        break;
      }

      let segResponse = null;
      let segSaltos = 0;
      let segAtualUrl = segUrl;
      let erroConexaoSeg = null;
      const tReq = Date.now();

      while (segSaltos <= maxSaltos) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          segResponse = await fetch(segAtualUrl, {
            redirect: "manual",
            signal: ctrl.signal,
          });
        } catch (err) {
          clearTimeout(timer);
          erroConexaoSeg = ctrl.signal.aborted ? "timeout" : "conexao";
          break;
        } finally {
          clearTimeout(timer);
        }

        if ([301, 302, 303, 307, 308].includes(segResponse.status)) {
          segSaltos++;
          if (segSaltos > maxSaltos) {
            erroConexaoSeg = "muitos-saltos";
            break;
          }
          const loc = segResponse.headers.get("location");
          if (!loc) {
            erroConexaoSeg = "conexao";
            break;
          }
          try {
            segAtualUrl = new URL(loc, segAtualUrl).href;
          } catch {
            erroConexaoSeg = "url-invalida";
            break;
          }
          continue;
        }
        break;
      }

      if (erroConexaoSeg) {
        erroSegmento = erroConexaoSeg;
        break;
      }

      if (!segResponse || segResponse.status !== 200) {
        erroSegmento = segResponse ? `segmento-http-${segResponse.status}` : "conexao";
        break;
      }

      let segBytes = 0;
      let erroLeituraCorpo = null;
      const ctrlCorpo = new AbortController();
      const tempoRestanteCorpo = Math.max(1, timeoutMs - (Date.now() - tReq));
      const timerCorpo = setTimeout(() => ctrlCorpo.abort(), tempoRestanteCorpo);

      try {
        if (!segResponse.body) {
          erroSegmento = "segmento-vazio";
          break;
        }
        const reader = segResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            segBytes += value.length;
          }
        }
      } catch (err) {
        erroLeituraCorpo = ctrlCorpo.signal.aborted ? "timeout" : "conexao";
      } finally {
        clearTimeout(timerCorpo);
      }

      if (erroLeituraCorpo) {
        erroSegmento = erroLeituraCorpo;
        break;
      }

      const tEnd = Date.now();
      const downloadMs = Math.max(1, tEnd - tReq);

      if (segBytes === 0) {
        erroSegmento = "segmento-vazio";
        break;
      }

      segmentosBaixados.push({
        bytes: segBytes,
        duracaoS: segInfo.duracao,
        downloadMs,
      });
    }

    const qtdSegmentos = segmentosBaixados.length;
    if (qtdSegmentos === 0) {
      return resolve({
        http,
        saltos: saltosAcumulados,
        hostFinal,
        ttfbMs,
        bytes: 0,
        kbps: 0,
        paradas: 0,
        maiorLacunaMs: 0,
        tipo: "hls",
        segmentos: 0,
        erro: erroSegmento,
      });
    }

    // 5. Cálculos métricas HLS
    const bytesTotal = segmentosBaixados.reduce((a, b) => a + b.bytes, 0);
    const duracaoTotalS = segmentosBaixados.reduce((a, b) => a + b.duracaoS, 0);
    const kbpsHls = duracaoTotalS > 0 ? Math.round((bytesTotal * 8) / duracaoTotalS / 1000) : 0;
    const segDownloadTotal = segmentosBaixados.reduce((a, b) => a + b.downloadMs, 0) / 1000;
    const velocidadeX = segDownloadTotal > 0 ? Number((duracaoTotalS / segDownloadTotal).toFixed(2)) : 0;
    let paradasHls = segmentosBaixados.filter((s) => s.downloadMs / 1000 > s.duracaoS).length;
    const maiorLacunaHls = Math.max(...segmentosBaixados.map((s) => s.downloadMs));

    // 6. Verificação de lista ao vivo parada
    if (
      !playlist.isVod &&
      playlist.targetDuration &&
      playlist.targetDuration > 0
    ) {
      const decorridoMedia = Date.now() - tempoPrimeiroDownloadMediaPlaylist;
      const necessarioMs = 1.5 * playlist.targetDuration * 1000;
      const tempoSobra = prazoFinal - Date.now();
      if (decorridoMedia >= necessarioMs && tempoSobra > 50) {
        try {
          const resChecagem = await baixarTextoComRedirecionamento(mediaPlaylistUrl, {
            maxSaltos,
            timeoutMs: Math.min(conexaoMs, tempoSobra),
          });
          if (resChecagem && resChecagem.ok && resChecagem.texto) {
            const novaPlaylist = parseMediaPlaylistHls(resChecagem.texto);
            const seqNaoAvancou = novaPlaylist.mediaSequence <= playlist.mediaSequence;
            const ultimoAntigo = playlist.segmentos.length > 0
              ? playlist.segmentos[playlist.segmentos.length - 1].uri
              : "";
            const ultimoNovo = novaPlaylist.segmentos.length > 0
              ? novaPlaylist.segmentos[novaPlaylist.segmentos.length - 1].uri
              : "";
            if (seqNaoAvancou && ultimoNovo && ultimoNovo === ultimoAntigo) {
              paradasHls += 1;
            }
          }
        } catch {}
      }
    }

    return resolve({
      http,
      saltos: saltosAcumulados,
      hostFinal,
      ttfbMs,
      bytes: bytesTotal,
      kbps: kbpsHls,
      paradas: paradasHls,
      maiorLacunaMs: maiorLacunaHls,
      tipo: "hls",
      erro: erroSegmento,
      segmentos: qtdSegmentos,
      velocidadeX,
    });
  });
}

/**
 * Classifica a sondagem em "limitado", "morto", "instavel" ou "vivo".
 *
 * @param {object} s - Objeto retornado por sondar().
 * @returns {"limitado" | "morto" | "instavel" | "vivo"}
 */
export function classificar(s) {
  if (s.http === 429) {
    return "limitado";
  }

  if (s.tipo === "hls") {
    if (s.segmentos === undefined) {
      if (
        (s.erro && s.bytes === 0) ||
        s.http >= 400 ||
        s.bytes === 0
      ) {
        return "morto";
      }
      if (s.http === 200) {
        return "vivo";
      }
      return "morto";
    }

    if (s.segmentos === 0 || s.bytes === 0) {
      return "morto";
    }
    if (s.paradas > 0 || s.velocidadeX < 1 || (s.erro && s.segmentos > 0)) {
      return "instavel";
    }
    return "vivo";
  }

  if (
    (s.erro && s.bytes === 0) ||
    s.http >= 400 ||
    s.bytes === 0 ||
    s.tipo === "html" ||
    s.tipo === "vazio" ||
    s.tipo === "outro"
  ) {
    return "morto";
  }

  if (s.tipo === "ts") {
    if (s.kbps >= 500 && s.maiorLacunaMs < 3000) {
      return "vivo";
    }
    return "instavel";
  }

  return "morto";
}

/**
 * Executa uma rodada de sondagem sobre a lista de canais.
 * Concorrência máxima 4. Pausa todos se encontrar 429 e tenta novamente o canal.
 *
 * @param {Array<{ nome: string, grupo: string, url: string }>} canais
 * @param {{
 *   rodada: number,
 *   leituraPadraoMs: number,
 *   leituraPrioritariaMs: number,
 *   prioritarios?: RegExp | null,
 *   concorrencia?: number,
 *   sondarFn?: Function,
 *   gravar: Function,
 *   pausaLimiteMs?: number
 * }} opcoes
 * @returns {Promise<{ total: number, porStatus: { vivo: number, instavel: number, morto: number, limitado: number } }>}
 */
/**
 * Roda uma sondagem com um TETO TOTAL de tempo (leituraMs + tetoExtraMs). Se a sondagem travar (conexão que nunca devolve dado,
 * corpo de segmento que não termina), devolve um resultado "travou" em vez de ficar esperando para sempre e prender a conexão
 * do monitor: antes um único canal travado parava a rodada inteira. O pedido abandonado é descartado quando o servidor responder.
 * @param {Function} sondarFn
 * @param {string} url
 * @param {number} leituraMs
 * @param {number} tetoExtraMs
 */
async function sondarComTeto(sondarFn, url, leituraMs, tetoExtraMs) {
  const tetoMs = (Number(leituraMs) || 0) + (Number(tetoExtraMs) || 0);
  let timer;
  const travou = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({
        http: 0, saltos: 0, hostFinal: "", ttfbMs: null, bytes: 0, kbps: 0, paradas: 0,
        maiorLacunaMs: tetoMs, tipo: "vazio", erro: "travou",
      }),
      tetoMs
    );
  });
  try {
    return await Promise.race([Promise.resolve(sondarFn(url, { leituraMs })), travou]);
  } finally {
    clearTimeout(timer);
  }
}

export async function executarRodada(
  canais,
  {
    rodada,
    leituraPadraoMs,
    leituraPrioritariaMs,
    prioritarios,
    concorrencia = 1,
    sondarFn = sondar,
    gravar,
    pausaLimiteMs = 90000,
    tetoExtraMs = 45000,
  }
) {
  const conc = Math.min(4, Math.max(1, Number(concorrencia) || 1));
  const porStatus = { vivo: 0, instavel: 0, morto: 0, limitado: 0 };

  let indiceProximo = 0;
  let pausaEmAndamento = null;

  async function worker() {
    while (true) {
      if (pausaEmAndamento) {
        await pausaEmAndamento;
      }

      if (indiceProximo >= canais.length) {
        break;
      }

      const canal = canais[indiceProximo++];
      const ehPrioritario = prioritarios && prioritarios.test(canal.nome);
      const leituraMs = ehPrioritario ? leituraPrioritariaMs : leituraPadraoMs;

      let s = await sondarComTeto(sondarFn, canal.url, leituraMs, tetoExtraMs);
      let status = classificar(s);

      if (status === "limitado") {
        let resolverPausa;
        pausaEmAndamento = new Promise((res) => (resolverPausa = res));

        await new Promise((r) => setTimeout(r, pausaLimiteMs));

        // Tenta de novo uma única vez
        s = await sondarComTeto(sondarFn, canal.url, leituraMs, tetoExtraMs);
        status = classificar(s);

        pausaEmAndamento = null;
        resolverPausa();
      }

      porStatus[status]++;

      const registro = {
        ts: new Date().toISOString(),
        rodada,
        canal: canal.nome,
        grupo: canal.grupo,
        familia: familiaDoCanal(canal.nome),
        status,
        http: s.http,
        saltos: s.saltos,
        hostFinal: s.hostFinal,
        ttfbMs: s.ttfbMs,
        bytes: s.bytes,
        kbps: s.kbps,
        paradas: s.paradas,
        maiorLacunaMs: s.maiorLacunaMs,
        tipo: s.tipo,
        erro: s.erro,
      };

      if (s.segmentos !== undefined) {
        registro.segmentos = s.segmentos;
      }
      if (s.velocidadeX !== undefined) {
        registro.velocidadeX = s.velocidadeX;
      }
      if (typeof gravar === "function") {
        await gravar(registro);
      }
    }
  }

  const workers = Array.from({ length: conc }, () => worker());
  await Promise.all(workers);

  return {
    total: canais.length,
    porStatus,
  };
}

/**
 * Lê registros de um arquivo JSONL, ignorando linhas inválidas e vazias.
 *
 * @param {string} textoJsonl
 * @returns {{ registros: Array<object>, invalidas: number }}
 */
export function lerSondagens(textoJsonl) {
  if (typeof textoJsonl !== "string") {
    return { registros: [], invalidas: 0 };
  }

  const linhas = textoJsonl.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const registros = [];
  let invalidas = 0;

  for (const linha of linhas) {
    const trim = linha.trim();
    if (!trim) continue;

    try {
      const obj = JSON.parse(trim);
      if (obj && typeof obj === "object" && obj.canal && obj.status) {
        registros.push(obj);
      } else {
        invalidas++;
      }
    } catch {
      invalidas++;
    }
  }

  return { registros, invalidas };
}

/**
 * Calcula a mediana de um array de números.
 *
 * @param {number[]} numeros
 * @returns {number}
 */
function calcularMediana(numeros) {
  if (!numeros || numeros.length === 0) return 0;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 0) {
    return Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
  }
  return ordenados[meio];
}

/**
 * Calcula o percentil 95 (P95) de um array de números.
 *
 * @param {number[]} numeros
 * @returns {number | null}
 */
function calcularP95(numeros) {
  if (!numeros || numeros.length === 0) return null;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.ceil(0.95 * ordenados.length) - 1);
  return ordenados[Math.max(0, idx)];
}

/**
 * Resume um conjunto de registros de sondagens por canal e família.
 *
 * @param {Array<object>} registros
 * @returns {{
 *   rodadas: number,
 *   canais: Array<object>,
 *   familias: Array<object>
 * }}
 */
export function resumir(registros) {
  if (!Array.isArray(registros) || registros.length === 0) {
    return { rodadas: 0, canais: [], familias: [] };
  }

  const rodadasSet = new Set(registros.map((r) => r.rodada));
  const rodadas = rodadasSet.size;

  // Agrupa por canal
  const mapaCanais = new Map();

  for (const r of registros) {
    if (!mapaCanais.has(r.canal)) {
      mapaCanais.set(r.canal, []);
    }
    mapaCanais.get(r.canal).push(r);
  }

  const listaCanaisResumo = [];

  for (const [nomeCanal, regs] of mapaCanais.entries()) {
    const grupo = regs[0].grupo || "";
    const familia = regs[0].familia || familiaDoCanal(nomeCanal);
    const total = regs.length;

    let vivos = 0;
    let instaveis = 0;
    let mortos = 0;
    let limitados = 0;

    let paradasTotal = 0;
    const hostsSet = new Set();
    const kbpsValidos = [];
    const ttfbValidos = [];
    const velocidadesXValidas = [];

    for (const reg of regs) {
      if (reg.status === "vivo") vivos++;
      else if (reg.status === "instavel") instaveis++;
      else if (reg.status === "morto") mortos++;
      else if (reg.status === "limitado") limitados++;

      if (reg.paradas) paradasTotal += reg.paradas;
      if (reg.hostFinal) hostsSet.add(reg.hostFinal);
      if (reg.bytes > 0 && typeof reg.kbps === "number") {
        kbpsValidos.push(reg.kbps);
      }
      if (reg.ttfbMs !== null && typeof reg.ttfbMs === "number") {
        ttfbValidos.push(reg.ttfbMs);
      }
      if (typeof reg.velocidadeX === "number" && !isNaN(reg.velocidadeX)) {
        velocidadesXValidas.push(reg.velocidadeX);
      }
    }

    const vivoPct = Number(((vivos / total) * 100).toFixed(1));
    const instavelPct = Number(((instaveis / total) * 100).toFixed(1));
    const mortoPct = Number(((mortos / total) * 100).toFixed(1));
    const limitadoPct = Number(((limitados / total) * 100).toFixed(1));

    // Quedas: quantas vezes vivo é seguido (na ordem de rodada) por != vivo e != limitado
    const regsOrdenados = [...regs].sort((a, b) => (a.rodada || 0) - (b.rodada || 0));
    const statusSemLimitado = regsOrdenados
      .map((r) => r.status)
      .filter((s) => s !== "limitado");

    let quedas = 0;
    for (let i = 0; i < statusSemLimitado.length - 1; i++) {
      if (statusSemLimitado[i] === "vivo" && statusSemLimitado[i + 1] !== "vivo") {
        quedas++;
      }
    }

    const kbpsMediana = calcularMediana(kbpsValidos);
    const ttfbP95Ms = calcularP95(ttfbValidos);
    const ultimoStatus = regsOrdenados[regsOrdenados.length - 1].status;
    const mediaVelocidadeX = velocidadesXValidas.length > 0
      ? Number((velocidadesXValidas.reduce((a, b) => a + b, 0) / velocidadesXValidas.length).toFixed(1))
      : null;
    // Veredito avaliado em ordem rígida
    let veredito;
    if (limitadoPct >= 50 || total < 3) {
      veredito = "sem-dados";
    } else if (vivoPct === 0 && instavelPct < 20) {
      veredito = "morto";
    } else if (instavelPct >= 50 || (vivoPct < 20 && instavelPct >= 20)) {
      veredito = "instavel";
    } else if (vivoPct < 90 || quedas >= 2) {
      veredito = "cai-muito";
    } else {
      veredito = "estavel";
    }

    listaCanaisResumo.push({
      canal: nomeCanal,
      grupo,
      familia,
      sondagens: total,
      vivoPct,
      instavelPct,
      mortoPct,
      limitadoPct,
      quedas,
      kbpsMediana,
      ttfbP95Ms,
      paradasTotal,
      hostsFinais: Array.from(hostsSet),
      ultimoStatus,
      velocidadeX: mediaVelocidadeX,
      x: mediaVelocidadeX,
      veredito,
    });
  }

  // Ordena por grupo e nome do canal
  listaCanaisResumo.sort((a, b) => {
    const cmpG = (a.grupo || "").localeCompare(b.grupo || "");
    if (cmpG !== 0) return cmpG;
    return (a.canal || "").localeCompare(b.canal || "");
  });

  // Agrupa famílias
  const mapaFamilias = new Map();
  for (const c of listaCanaisResumo) {
    if (!mapaFamilias.has(c.familia)) {
      mapaFamilias.set(c.familia, []);
    }
    mapaFamilias.get(c.familia).push(c);
  }

  const familias = [];
  for (const [nomeFamilia, canaisFam] of mapaFamilias.entries()) {
    // Escolhe melhor: maior vivoPct; empate: maior kbpsMediana; empate: ordem alfabética
    const ordenados = [...canaisFam].sort((a, b) => {
      if (b.vivoPct !== a.vivoPct) return b.vivoPct - a.vivoPct;
      if (b.kbpsMediana !== a.kbpsMediana) return b.kbpsMediana - a.kbpsMediana;
      return a.canal.localeCompare(b.canal);
    });

    const melhor = ordenados[0].canal;
    const algumVivo = canaisFam.some((c) => c.vivoPct >= 50);

    familias.push({
      familia: nomeFamilia,
      canais: canaisFam.map((c) => c.canal),
      melhor,
      algumVivo,
    });
  }

  familias.sort((a, b) => a.familia.localeCompare(b.familia));

  return {
    rodadas,
    canais: listaCanaisResumo,
    familias,
  };
}

/**
 * Formata o resumo em texto tabular alinhado para visualização no console.
 *
 * @param {{ canais: Array<object> }} resumo
 * @returns {string}
 */
export function tabelaTexto(resumo) {
  if (!resumo || !Array.isArray(resumo.canais) || resumo.canais.length === 0) {
    return "Nenhum canal no resumo.\n";
  }

  const headers = ["FAMÍLIA", "CANAL", "VIVO%", "QUEDAS", "KBPS", "X", "VEREDITO"];
  const rows = resumo.canais.map((c) => [
    c.familia || "",
    c.canal || "",
    `${c.vivoPct ?? 0}%`,
    String(c.quedas ?? 0),
    String(c.kbpsMediana ?? 0),
    c.velocidadeX != null ? Number(c.velocidadeX).toFixed(1) : "-",
    c.veredito || "",
  ]);

  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      if (r[i].length > max) max = r[i].length;
    }
    return max;
  });

  function formatRow(cols) {
    return cols.map((col, i) => col.padEnd(colWidths[i])).join(" | ");
  }

  const headerLine = formatRow(headers);
  const sepLine = colWidths.map((w) => "-".repeat(w)).join("-+-");
  const dataLines = rows.map((r) => formatRow(r)).join("\n");

  return `${headerLine}\n${sepLine}\n${dataLines}\n`;
}
