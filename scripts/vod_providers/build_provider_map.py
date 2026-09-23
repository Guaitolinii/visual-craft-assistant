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


def search_tmdb_id(tmdb_api_key, media_type, name, year):
    """Busca o id TMDB de um título do catálogo por nome (+ano quando houver).
    Devolve None se não achar - o item some do mapa (fica sem selo), nunca
    quebra o restante do processamento."""
    endpoint = "search/movie" if media_type == "movie" else "search/tv"
    year_param = "year" if media_type == "movie" else "first_air_date_year"
    params = {"api_key": tmdb_api_key, "query": name, "language": "pt-BR"}
    if year:
        params[year_param] = year
    try:
        data = _http_get_json(f"{TMDB_BASE}/{endpoint}?{urllib.parse.urlencode(params)}")
    except Exception as exc:
        print(f"[aviso] busca falhou para '{name}' ({year}): {exc}", file=sys.stderr)
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
    print(f"[*] Baixando catálogo Xtream ({xtream_action})...")
    catalog = fetch_xtream_catalog(base, user, password, xtream_action)
    if not isinstance(catalog, list):
        print(f"[aviso] resposta inesperada de {xtream_action}, pulando.", file=sys.stderr)
        return {}

    print(f"[*] Baixando catálogos de streaming BR via TMDB ({media_type})...")
    provider_id_sets = fetch_provider_id_sets(tmdb_api_key, media_type)

    out = {}
    for entry in catalog:
        # Nome e ano lidos dos mesmos campos que o app usa na chave (ver
        # provider_key_for_entry) - item sem nome nunca teria selo no app.
        name = entry.get("name") or ""
        year = vod_item_year_key(entry)
        if not name.strip(_JS_TRIM_CHARS):
            continue
        tmdb_id = search_tmdb_id(tmdb_api_key, media_type, name, year)
        time.sleep(0.05)  # respeita o rate limit da TMDB (~50 req/s)
        if tmdb_id is None:
            continue
        providers = [short for pid, short in PROVIDERS_BR.items() if tmdb_id in provider_id_sets.get(pid, ())]
        if providers:
            out[provider_key_for_entry(entry)] = providers
    print(f"[✓] {len(out)}/{len(catalog)} títulos casados com pelo menos um streaming.")
    return out


def main():
    base = os.environ.get("VOD_XTREAM_BASE")
    user = os.environ.get("VOD_XTREAM_USER")
    password = os.environ.get("VOD_XTREAM_PASS")
    tmdb_api_key = os.environ.get("TMDB_API_KEY")
    missing = [n for n, v in [("VOD_XTREAM_BASE", base), ("VOD_XTREAM_USER", user),
                              ("VOD_XTREAM_PASS", password), ("TMDB_API_KEY", tmdb_api_key)] if not v]
    if missing:
        print(f"[erro] variáveis de ambiente ausentes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    movies = build_map_for(base, user, password, tmdb_api_key, "get_vod_streams", "movie")
    series = build_map_for(base, user, password, tmdb_api_key, "get_series", "tv")

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "movies": movies,
        "series": series,
    }
    with open("vod-providers.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("[✓] vod-providers.json gravado.")


if __name__ == "__main__":
    main()
