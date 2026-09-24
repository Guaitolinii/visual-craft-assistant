"""
Cruza o catálogo de Filmes/Séries do provedor Xtream com a base pública da
TMDB (watch/providers, região BR) e gera vod-providers.json: um mapa
"titulo|ano" -> lista de streamings onde aquele título está disponível hoje.

Roda 1x/dia via .github/workflows/vod-providers.yml. Não lê nem escreve
nenhuma credencial de usuário final - as do Xtream vêm só de variáveis de
ambiente (secrets do repositório), nunca de um valor fixo no código.

IDs de provedor TMDB para o Brasil (https://api.themoviedb.org/3/watch/providers/movie?watch_region=BR):
netflix=8, prime video=119, max=1899, disney plus=337, apple tv plus=350,
paramount plus=531, globoplay=307.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TMDB_BASE = "https://api.themoviedb.org/3"
DISCOVER_PAGES_PER_PROVIDER = 5  # ~100 títulos mais populares por streaming

# ─── Proteção contra falha TOTAL do upstream ───
# Se o Xtream ou a TMDB falharem como um todo, o script sai com erro SEM
# gravar vod-providers.json: o passo do workflow falha, o commit não roda e
# o último arquivo bom da branch vod-data continua valendo (senão um mapa
# vazio apagaria todos os selos do app). Já um resultado honesto pequeno -
# fontes saudáveis com poucos ou até zero casamentos - é gravado normalmente.
EXIT_MISSING_ENV = 1
EXIT_UPSTREAM_FAILURE = 2
# Catálogo Xtream com menos itens que isso = falha. Painel com login
# inválido/expirado costuma responder [] (ou um dict) em vez de erro HTTP.
MIN_CATALOG_ENTRIES = 1
# Menos streamings com pelo menos 1 título na TMDB que isso = falha: com a
# chave TMDB inválida/expirada ou sem rede, todo discover falha e todos os
# conjuntos vêm vazios. Um streaming vazio sozinho (id aposentado, página
# que falhou) só gera aviso - não é motivo para descartar os outros seis.
MIN_PROVIDERS_WITH_TITLES = 1
# Fração máxima das buscas TMDB que podem falhar com ERRO (rede/HTTP) antes
# de considerar a fase de busca morta. "Busca sem resultado" não é erro e
# não conta aqui - é o caso honesto de título que a TMDB não conhece.
MAX_SEARCH_ERROR_RATIO = 0.5
# Catálogo Xtream TRUNCADO (painel instável devolve uma lista válida, mas só
# uma fração dos títulos) passa por todas as guardas acima. Por isso o total
# de títulos casados de hoje é comparado, por tipo de mídia, com o do
# vod-providers.json anterior (o workflow faz checkout da branch vod-data
# antes de rodar, então o arquivo de ontem está no diretório): hoje abaixo
# dessa fração do anterior = falha.
MIN_MATCH_RATIO_VS_PREVIOUS = 0.2
# Só compara quando o arquivo anterior tinha pelo menos isso de títulos
# casados naquele tipo: a semente vazia da primeira execução ({}), ou uma
# base anterior pequena demais, não servem de referência. Para aceitar uma
# queda real e legítima, basta voltar o arquivo da vod-data para a semente.
MIN_PREVIOUS_MATCHES_FOR_DROP_CHECK = 50
OUTPUT_FILE = "vod-providers.json"


class UpstreamFailure(Exception):
    """Xtream ou TMDB falharam como um todo - o JSON não deve ser gravado."""


def _redact(text, *secrets):
    """Tira usuário/senha do Xtream de uma mensagem de erro antes de
    imprimir: alguns erros do urllib repetem a URL inteira, que carrega as
    credenciais na query string (crua ou url-encoded)."""
    for secret in secrets:
        if secret:
            for form in {secret, urllib.parse.quote_plus(secret)}:
                text = text.replace(form, "***")
    return text

# id TMDB -> chave curta usada no app (badges de PROVIDERS_BR em sintoniza-link.html).
# A ordem aqui é a ordem da lista gravada para cada título, e o selo do
# cartão mostra o primeiro item - por isso segue o PROVIDER_ORDER do app.
PROVIDERS_BR = {
    8: "netflix",
    119: "prime",
    1899: "max",
    337: "disney",
    350: "apple",
    531: "paramount",
    307: "globoplay",
}


# Exatamente os caracteres que String.prototype.trim() do JS remove
# (WhiteSpace + LineTerminator da especificação ECMAScript). O str.strip()
# sem argumento do Python NÃO é igual: ele também remove U+001C..U+001F e
# U+0085, e não remove o BOM (U+FEFF) - um nome com BOM ou com um desses
# controles nas pontas geraria uma chave diferente da do app.
_JS_TRIM_CHARS = (
    "\t\n\v\f\r \u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _parse_json_bytes(raw):
    """Decodifica como o Response.json() do navegador: BOM inicial removido e
    byte UTF-8 inválido vira U+FFFD. Assim o nome que chega aqui é o mesmo
    texto que o app lê do mesmo endpoint, e um único byte ruim num catálogo
    de dezenas de milhares de títulos não derruba o script inteiro."""
    return json.loads(raw.decode("utf-8-sig", errors="replace"))


def _http_get_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "vod-provider-crossref/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return _parse_json_bytes(resp.read())


def normalize_key(name, year):
    """Mesma forma de chave usada por providerKeyForItem() no app - nome em
    minúsculas e sem espaços nas pontas (mesmo conjunto do trim() do JS),
    sem remover acento ou pontuação, e o ano concatenado com '|'. Qualquer
    normalização a mais aqui faria as chaves nunca baterem com o lado JS."""
    return f"{(name or '').strip(_JS_TRIM_CHARS).lower()}|{year or ''}"


def vod_item_year_key(entry):
    """Espelha vodItemYearKey() do app: filmes trazem "year", séries trazem
    "releaseDate" (ex: "2019-05-10"). O "or ''" dentro do str() importa:
    séries costumam vir com "releaseDate": null, e str(None) viraria "None"
    na chave, enquanto o JS (String(null || "")) produz ""."""
    return entry.get("year") or str(entry.get("releaseDate") or "")[:4]


def provider_key_for_entry(entry):
    """Espelha providerKeyForItem() do app para um item cru da API Xtream:
    só item.name (o app não cai para "title") + o ano de vod_item_year_key."""
    return normalize_key(entry.get("name"), vod_item_year_key(entry))


def fetch_provider_id_sets(tmdb_api_key, media_type):
    """media_type: 'movie' ou 'tv'. Devolve {tmdb_provider_id: set(tmdb_ids)}."""
    endpoint = "discover/movie" if media_type == "movie" else "discover/tv"
    result = {}
    for provider_id in PROVIDERS_BR:
        ids = set()
        for page in range(1, DISCOVER_PAGES_PER_PROVIDER + 1):
            params = urllib.parse.urlencode({
                "api_key": tmdb_api_key,
                "watch_region": "BR",
                "with_watch_providers": provider_id,
                "sort_by": "popularity.desc",
                "page": page,
            })
            try:
                data = _http_get_json(f"{TMDB_BASE}/{endpoint}?{params}")
            except Exception as exc:
                print(f"[aviso] {endpoint} provider={provider_id} page={page} falhou: {exc}", file=sys.stderr)
                break
            for entry in data.get("results", []):
                ids.add(entry["id"])
            if page >= data.get("total_pages", 1):
                break
        result[provider_id] = ids
        print(f"  -> provider {provider_id} ({media_type}): {len(ids)} títulos")
    return result


def search_tmdb_id(tmdb_api_key, media_type, name, year, error_log=None):
    """Busca o id TMDB de um título do catálogo por nome (+ano quando houver).
    Devolve None se não achar - o item some do mapa (fica sem selo), nunca
    quebra o restante do processamento. error_log (lista, opcional) recebe
    cada erro de rede/HTTP, para build_map_for separar "sem resultado"
    (honesto) de "busca fora do ar" (falha total)."""
    endpoint = "search/movie" if media_type == "movie" else "search/tv"
    year_param = "year" if media_type == "movie" else "first_air_date_year"
    params = {"api_key": tmdb_api_key, "query": name, "language": "pt-BR"}
    if year:
        params[year_param] = year
    try:
        data = _http_get_json(f"{TMDB_BASE}/{endpoint}?{urllib.parse.urlencode(params)}")
    except Exception as exc:
        print(f"[aviso] busca falhou para '{name}' ({year}): {exc}", file=sys.stderr)
        if error_log is not None:
            error_log.append(exc)
        return None
    results = data.get("results") or []
    return results[0]["id"] if results else None


def fetch_xtream_catalog(base, user, password, action):
    """action: 'get_vod_streams' ou 'get_series'. Mesmo endpoint que o app
    já usa (xtreamApiUrl em sintoniza-link.html) - lista completa, sem
    paginar por categoria aqui porque não precisamos separar por gênero
    neste script, só cruzar título+ano."""
    params = urllib.parse.urlencode({"username": user, "password": password, "action": action})
    return _http_get_json(f"{base}/player_api.php?{params}")


def build_map_for(base, user, password, tmdb_api_key, xtream_action, media_type):
    """Mapa chave -> streamings para um tipo de mídia. Levanta
    UpstreamFailure quando o Xtream ou a TMDB falharam como um todo (ver os
    limites no topo do arquivo) - nunca devolve um mapa vazio "de mentira"."""
    print(f"[*] Baixando catálogo Xtream ({xtream_action})...")
    try:
        catalog = fetch_xtream_catalog(base, user, password, xtream_action)
    except Exception as exc:
        detail = _redact(f"{type(exc).__name__}: {exc}", user, password)
        raise UpstreamFailure(f"catálogo Xtream ({xtream_action}) falhou: {detail}") from exc
    if not isinstance(catalog, list):
        # Só o tipo e as chaves: o user_info do Xtream traz usuário e senha.
        shape = type(catalog).__name__
        if isinstance(catalog, dict):
            shape += f" com chaves {sorted(catalog)[:5]}"
        raise UpstreamFailure(f"catálogo Xtream ({xtream_action}) não veio como lista ({shape}) - "
                              "login inválido/expirado ou formato inesperado")
    if len(catalog) < MIN_CATALOG_ENTRIES:
        raise UpstreamFailure(f"catálogo Xtream ({xtream_action}) veio vazio - "
                              "painel costuma responder assim para login inválido/expirado")

    print(f"[*] Baixando catálogos de streaming BR via TMDB ({media_type})...")
    provider_id_sets = fetch_provider_id_sets(tmdb_api_key, media_type)
    with_titles = [pid for pid, ids in provider_id_sets.items() if ids]
    if len(with_titles) < MIN_PROVIDERS_WITH_TITLES:
        raise UpstreamFailure(f"nenhum streaming trouxe títulos da TMDB ({media_type}) - "
                              "chave TMDB inválida/expirada ou TMDB/rede fora do ar")
    empty = [PROVIDERS_BR[pid] for pid, ids in provider_id_sets.items() if not ids]
    if empty:
        print(f"[aviso] streamings sem nenhum título na TMDB ({media_type}): {', '.join(empty)}", file=sys.stderr)

    out = {}
    searched = 0
    search_errors = []
    for entry in catalog:
        # Nome e ano lidos dos mesmos campos que o app usa na chave (ver
        # provider_key_for_entry) - item sem nome nunca teria selo no app.
        name = entry.get("name") or ""
        year = vod_item_year_key(entry)
        if not name.strip(_JS_TRIM_CHARS):
            continue
        searched += 1
        tmdb_id = search_tmdb_id(tmdb_api_key, media_type, name, year, error_log=search_errors)
        time.sleep(0.05)  # respeita o rate limit da TMDB (~50 req/s)
        if tmdb_id is None:
            continue
        providers = [short for pid, short in PROVIDERS_BR.items() if tmdb_id in provider_id_sets.get(pid, ())]
        if providers:
            out[provider_key_for_entry(entry)] = providers
    if searched and len(search_errors) / searched > MAX_SEARCH_ERROR_RATIO:
        raise UpstreamFailure(f"{len(search_errors)}/{searched} buscas na TMDB ({media_type}) falharam com erro - "
                              "fase de busca fora do ar")
    print(f"[✓] {len(out)}/{len(catalog)} títulos casados com pelo menos um streaming.")
    return out


def load_previous_match_counts(path=OUTPUT_FILE):
    """Quantos títulos casados o arquivo anterior tinha em cada tipo:
    {"movies": n | None, "series": n | None}. None = sem referência para
    aquele tipo (arquivo ausente, ilegível, JSON inválido ou formato
    inesperado) - isso nunca aborta, só pula a comparação daquele tipo."""
    counts = {"movies": None, "series": None}
    try:
        with open(path, "rb") as f:
            previous = _parse_json_bytes(f.read())
    except (OSError, ValueError) as exc:
        if not isinstance(exc, FileNotFoundError):
            print(f"[aviso] {path} anterior ilegível, comparação com ontem pulada: "
                  f"{type(exc).__name__}", file=sys.stderr)
        return counts
    if isinstance(previous, dict):
        for kind in counts:
            if isinstance(previous.get(kind), dict):
                counts[kind] = len(previous[kind])
    return counts


def check_no_sharp_drop(previous_counts, today):
    """Levanta UpstreamFailure se algum tipo de mídia casou bem menos
    títulos hoje do que na execução anterior (ver
    MIN_MATCH_RATIO_VS_PREVIOUS). today: {"movies": mapa, "series": mapa}."""
    for kind, current_map in today.items():
        before = previous_counts.get(kind)
        if before is None or before < MIN_PREVIOUS_MATCHES_FOR_DROP_CHECK:
            continue
        now = len(current_map)
        if now < before * MIN_MATCH_RATIO_VS_PREVIOUS:
            media_type = "movie" if kind == "movies" else "tv"
            raise UpstreamFailure(
                f"só {now} títulos casados hoje ({media_type}) contra {before} na execução anterior "
                f"(mínimo {MIN_MATCH_RATIO_VS_PREVIOUS:.0%}) - catálogo Xtream provavelmente truncado")


def main():
    base = os.environ.get("VOD_XTREAM_BASE")
    user = os.environ.get("VOD_XTREAM_USER")
    password = os.environ.get("VOD_XTREAM_PASS")
    tmdb_api_key = os.environ.get("TMDB_API_KEY")
    missing = [n for n, v in [("VOD_XTREAM_BASE", base), ("VOD_XTREAM_USER", user),
                              ("VOD_XTREAM_PASS", password), ("TMDB_API_KEY", tmdb_api_key)] if not v]
    if missing:
        print(f"[erro] variáveis de ambiente ausentes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(EXIT_MISSING_ENV)

    # Contagem do arquivo anterior lida antes de tudo (é o de ontem, vindo do
    # checkout da vod-data) para detectar um catálogo truncado hoje.
    previous_counts = load_previous_match_counts()

    # Os dois mapas são montados ANTES de abrir o arquivo: qualquer falha
    # total (de filmes ou de séries) sai daqui sem tocar no JSON anterior.
    try:
        movies = build_map_for(base, user, password, tmdb_api_key, "get_vod_streams", "movie")
        series = build_map_for(base, user, password, tmdb_api_key, "get_series", "tv")
        check_no_sharp_drop(previous_counts, {"movies": movies, "series": series})
    except UpstreamFailure as exc:
        print(f"[erro] {exc}", file=sys.stderr)
        print("[erro] vod-providers.json NÃO foi gravado - o último arquivo bom continua valendo.", file=sys.stderr)
        sys.exit(EXIT_UPSTREAM_FAILURE)

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "movies": movies,
        "series": series,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("[✓] vod-providers.json gravado.")


if __name__ == "__main__":
    main()
