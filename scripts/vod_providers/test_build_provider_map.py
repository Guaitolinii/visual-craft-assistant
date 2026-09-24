# scripts/vod_providers/test_build_provider_map.py
import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest import mock

import build_provider_map as bpm
from build_provider_map import (
    normalize_key, vod_item_year_key, provider_key_for_entry, _parse_json_bytes, PROVIDERS_BR,
)

class TestNormalizeKey(unittest.TestCase):
    def test_matches_js_key_shape(self):
        # Precisa bater exatamente com providerKeyForItem no sintoniza-link.html:
        # `${name.trim().toLowerCase()}|${year}` - mesmo par nome+ano, sem
        # remover acento nem pontuação, senão as chaves nunca se encontram.
        self.assertEqual(normalize_key("  Duna: Parte Dois ", "2024"), "duna: parte dois|2024")

    def test_lowercases_accented_characters(self):
        self.assertEqual(normalize_key("Ação", "2020"), "ação|2020")

    def test_empty_year_still_produces_a_key(self):
        self.assertEqual(normalize_key("Sem Ano", ""), "sem ano|")

    def test_strips_bom_like_js_trim(self):
        # String.prototype.trim() remove o BOM (U+FEFF); str.strip() do Python não.
        self.assertEqual(normalize_key("\ufeffFilme Com BOM", "2003"), "filme com bom|2003")

    def test_keeps_control_chars_that_js_trim_keeps(self):
        # str.strip() do Python remove U+001C..U+001F e U+0085; o trim() do JS não.
        self.assertEqual(normalize_key("\x1fFilme\x85", "2004"), "\x1ffilme\x85|2004")

    def test_strips_unicode_spaces_like_js_trim(self):
        self.assertEqual(normalize_key("\u3000Filme\u00a0\u2028", "2006"), "filme|2006")

    def test_numeric_year_formats_like_js_template_literal(self):
        self.assertEqual(normalize_key("Filme", 2024), "filme|2024")

class TestVodItemYearKey(unittest.TestCase):
    # Espelha vodItemYearKey() do app: item.year || String(item.releaseDate || "").slice(0, 4)
    def test_movie_uses_year(self):
        self.assertEqual(vod_item_year_key({"year": "2024", "releaseDate": "2019-05-10"}), "2024")

    def test_series_uses_release_date_prefix(self):
        self.assertEqual(vod_item_year_key({"releaseDate": "2019-05-10"}), "2019")

    def test_null_release_date_gives_empty_year(self):
        # Xtream costuma mandar "releaseDate": null em séries - no JS vira "",
        # nunca "None".
        self.assertEqual(vod_item_year_key({"releaseDate": None}), "")
        self.assertEqual(vod_item_year_key({"year": None, "releaseDate": None}), "")

    def test_falsy_year_falls_back_to_release_date(self):
        self.assertEqual(vod_item_year_key({"year": 0, "releaseDate": "2011-01-01"}), "2011")
        self.assertEqual(vod_item_year_key({"year": "", "releaseDate": "2018"}), "2018")

    def test_missing_everything_gives_empty_year(self):
        self.assertEqual(vod_item_year_key({}), "")

class TestProviderKeyForEntry(unittest.TestCase):
    # Espelha providerKeyForItem() do app para um item cru da API Xtream.
    def test_series_with_null_release_date(self):
        self.assertEqual(provider_key_for_entry({"name": "Serie X", "releaseDate": None}), "serie x|")

    def test_uses_name_only_like_the_app(self):
        # O app chaveia só por item.name (sem cair para title).
        self.assertEqual(provider_key_for_entry({"title": "Outro Nome", "year": "2020"}), "|2020")

class TestParseJsonBytes(unittest.TestCase):
    # Mesma decodificação do Response.json() do navegador: BOM removido e
    # byte UTF-8 inválido vira U+FFFD (em vez de derrubar o script inteiro).
    def test_strips_utf8_bom(self):
        self.assertEqual(_parse_json_bytes(b'\xef\xbb\xbf[{"name": "A"}]'), [{"name": "A"}])

    def test_invalid_utf8_becomes_replacement_char(self):
        self.assertEqual(_parse_json_bytes(b'[{"name": "A\xc3(B"}]'), [{"name": "A\ufffd(B"}])

class TestProvidersConfig(unittest.TestCase):
    def test_seven_brazilian_providers_configured(self):
        # Mesmo conjunto usado nos badges do app (Task 2) - se um lado
        # adicionar um streaming nomeado diferente, o selo nunca aparece.
        self.assertEqual(
            set(PROVIDERS_BR.values()),
            {"netflix", "prime", "max", "disney", "apple", "paramount", "globoplay"},
        )

    def test_order_matches_app_provider_order(self):
        # A lista de cada título sai nesta ordem e o selo do cartão mostra o
        # primeiro item (streamingProviders[0]) - mesma ordem do
        # PROVIDER_ORDER do sintoniza-link.html.
        self.assertEqual(
            list(PROVIDERS_BR.values()),
            ["netflix", "prime", "max", "disney", "apple", "paramount", "globoplay"],
        )


# ─── main() de ponta a ponta, sem rede ───────────────────────────────────
# Credenciais falsas (nenhum provedor/TMDB real é tocado): _http_get_json é
# trocado por um roteador em memória e urlopen explode se algo escapar.
FAKE_ENV = {
    "VOD_XTREAM_BASE": "http://xtream.invalid",
    "VOD_XTREAM_USER": "usuario-falso",
    "VOD_XTREAM_PASS": "senha-falsa-123",
    "TMDB_API_KEY": "chave-tmdb-falsa",
}
HEALTHY_MOVIES = [
    {"name": "Filme Netflix", "year": "2024"},
    {"name": "Filme Duplo", "year": "2023"},
    {"name": "Filme Sem Streaming", "year": "2020"},
    {"name": "Nao Existe Na TMDB", "year": "1999"},
]
HEALTHY_SERIES = [
    {"name": "Serie Nula", "releaseDate": None},
    {"name": "Serie Data", "releaseDate": "2019-05-10"},
]
HEALTHY_CATALOGS = {"get_vod_streams": HEALTHY_MOVIES, "get_series": HEALTHY_SERIES}
SEARCH_IDS = {
    ("movie", "Filme Netflix"): 1001, ("movie", "Filme Duplo"): 1002,
    ("movie", "Filme Sem Streaming"): 1003,
    ("tv", "Serie Nula"): 2001, ("tv", "Serie Data"): 2002,
}
DISCOVER_IDS = {
    ("movie", 8): [1001], ("movie", 337): [1002], ("movie", 1899): [1002],
    ("tv", 307): [2001], ("tv", 337): [2002],
}
TMDB_401 = urllib.error.HTTPError("https://tmdb.invalid", 401, "Unauthorized", None, None)


def fake_http(catalogs=None, discover_ids=None, search_ids=None,
              discover_error=None, search_error=None, search_error_for=()):
    """Roteador falso no lugar de _http_get_json: responde player_api.php
    (catálogo Xtream), discover/* e search/* da TMDB a partir de dicionários."""
    catalogs = HEALTHY_CATALOGS if catalogs is None else catalogs
    discover_ids = DISCOVER_IDS if discover_ids is None else discover_ids
    search_ids = SEARCH_IDS if search_ids is None else search_ids

    def _get(url, timeout=15):
        parsed = urllib.parse.urlparse(url)
        q = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        if parsed.path.endswith("/player_api.php"):
            value = catalogs[q["action"]]
            if isinstance(value, Exception):
                raise value
            return value
        media = "movie" if parsed.path.endswith("/movie") else "tv"
        if "/discover/" in parsed.path:
            if discover_error:
                raise discover_error
            ids = discover_ids.get((media, int(q["with_watch_providers"])), [])
            return {"results": [{"id": i} for i in ids], "total_pages": 1}
        if search_error or q["query"] in search_error_for:
            raise search_error or urllib.error.URLError("timed out")
        tmdb_id = search_ids.get((media, q["query"]))
        return {"results": [{"id": tmdb_id}] if tmdb_id else []}
    return _get


class MainHarness:
    """Roda main() num diretório temporário, sem rede. LAST_GOOD é o
    vod-providers.json pré-existente - simula o checkout da branch vod-data
    no workflow (o arquivo bom da execução anterior)."""

    LAST_GOOD = '{"generatedAt": "ontem", "movies": {"x|2020": ["netflix"]}, "series": {}}'

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        old_cwd = os.getcwd()
        os.chdir(tmp.name)
        self.addCleanup(os.chdir, old_cwd)
        with open("vod-providers.json", "w", encoding="utf-8") as f:
            f.write(self.LAST_GOOD)

        self.stderr = io.StringIO()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(mock.patch.dict(os.environ, FAKE_ENV))
        stack.enter_context(mock.patch("urllib.request.urlopen",
                                       side_effect=AssertionError("rede real no teste!")))
        stack.enter_context(mock.patch.object(bpm, "time"))  # time.sleep vira no-op
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        stack.enter_context(contextlib.redirect_stderr(self.stderr))

    def run_main(self, http):
        with mock.patch.object(bpm, "_http_get_json", http):
            bpm.main()

    def assert_aborted_without_writing(self, http):
        with self.assertRaises(SystemExit) as cm:
            self.run_main(http)
        self.assertNotEqual(cm.exception.code, 0)
        self.assertEqual(cm.exception.code, bpm.EXIT_UPSTREAM_FAILURE)
        with open("vod-providers.json", encoding="utf-8") as f:
            self.assertEqual(f.read(), self.LAST_GOOD, "o último arquivo bom foi sobrescrito")
        return self.stderr.getvalue()

    def read_written(self):
        with open("vod-providers.json", encoding="utf-8") as f:
            return json.load(f)

    def set_previous(self, text):
        with open("vod-providers.json", "w", encoding="utf-8") as f:
            f.write(text)


class TestMainUpstreamGuards(MainHarness, unittest.TestCase):
    """Falha TOTAL do Xtream/TMDB: sai com erro e NÃO grava o JSON (o passo
    do workflow falha e o último arquivo bom da branch vod-data fica). Fontes
    saudáveis com poucos ou zero casamentos: grava normalmente."""

    # (a) catálogo que não é lista -> erro, arquivo intocado
    def test_catalog_not_a_list_aborts_without_writing(self):
        err = self.assert_aborted_without_writing(fake_http(
            catalogs={"get_vod_streams": {"user_info": {"auth": 0}}, "get_series": HEALTHY_SERIES}))
        self.assertIn("get_vod_streams", err)

    def test_series_catalog_failure_aborts_even_after_movies_succeed(self):
        # Filmes deram certo, mas gravar só com séries {} apagaria os selos de série.
        err = self.assert_aborted_without_writing(fake_http(
            catalogs={"get_vod_streams": HEALTHY_MOVIES, "get_series": None}))
        self.assertIn("get_series", err)

    def test_empty_catalog_aborts_without_writing(self):
        # Painel Xtream com login inválido/expirado costuma responder [] em vez de erro.
        self.assert_aborted_without_writing(fake_http(
            catalogs={"get_vod_streams": [], "get_series": HEALTHY_SERIES}))

    def test_xtream_request_error_aborts_without_leaking_credentials(self):
        leaky = ValueError("unknown url type: 'xtream.invalid/player_api.php"
                           "?username=usuario-falso&password=senha-falsa-123'")
        err = self.assert_aborted_without_writing(fake_http(
            catalogs={"get_vod_streams": leaky, "get_series": HEALTHY_SERIES}))
        self.assertNotIn("senha-falsa-123", err)
        self.assertNotIn("usuario-falso", err)

    # (b) todos os conjuntos de streaming vazios -> erro, arquivo intocado
    def test_bad_tmdb_key_empties_every_provider_set_and_aborts(self):
        err = self.assert_aborted_without_writing(fake_http(discover_error=TMDB_401))
        self.assertIn("TMDB", err)

    def test_every_provider_set_empty_without_errors_aborts(self):
        self.assert_aborted_without_writing(fake_http(discover_ids={}))

    def test_search_phase_failing_with_errors_aborts(self):
        # discover ok, mas toda busca dá erro de rede -> mapa vazio que não é honesto.
        self.assert_aborted_without_writing(fake_http(search_error=urllib.error.URLError("timed out")))

    # (c) fontes saudáveis, zero casamentos -> grava, exit 0
    def test_healthy_inputs_with_zero_matches_write_the_file(self):
        self.run_main(fake_http(discover_ids={("movie", 8): [9001], ("tv", 8): [9002]}))
        out = self.read_written()
        self.assertEqual(out["movies"], {})
        self.assertEqual(out["series"], {})
        self.assertTrue(out["generatedAt"].endswith("+00:00"))

    def test_healthy_inputs_write_the_expected_map(self):
        self.run_main(fake_http())
        out = self.read_written()
        self.assertEqual(set(out), {"generatedAt", "movies", "series"})
        self.assertEqual(out["movies"], {"filme netflix|2024": ["netflix"],
                                         "filme duplo|2023": ["max", "disney"]})
        self.assertEqual(out["series"], {"serie nula|": ["globoplay"],
                                         "serie data|2019": ["disney"]})

    def test_some_provider_sets_empty_still_write(self):
        # Um streaming sem título (id aposentado, página que falhou) só gera aviso.
        self.run_main(fake_http(discover_ids={("movie", 8): [1001], ("tv", 307): [2001]}))
        out = self.read_written()
        self.assertEqual(out["movies"], {"filme netflix|2024": ["netflix"]})
        self.assertEqual(out["series"], {"serie nula|": ["globoplay"]})

    def test_a_few_search_errors_still_write(self):
        # 1 de 4 buscas de filme com erro (25%) fica abaixo do limite.
        self.run_main(fake_http(search_error_for={"Filme Duplo"}))
        out = self.read_written()
        self.assertEqual(out["movies"], {"filme netflix|2024": ["netflix"]})

    def test_missing_env_still_exits_before_any_request(self):
        with mock.patch.dict(os.environ, {"TMDB_API_KEY": ""}):
            with self.assertRaises(SystemExit) as cm:
                self.run_main(fake_http())
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("TMDB_API_KEY", self.stderr.getvalue())


def previous_file(n_movies, n_series):
    """vod-providers.json de uma execução anterior com n casamentos por tipo."""
    return json.dumps({
        "generatedAt": "ontem",
        "movies": {f"filme antigo {i}|2020": ["netflix"] for i in range(n_movies)},
        "series": {f"serie antiga {i}|": ["globoplay"] for i in range(n_series)},
    })


def bulk_http(n_movies, n_series):
    """Fontes saudáveis em que cada título do catálogo casa com a Netflix:
    o mapa de hoje sai com exatamente n_movies filmes e n_series séries."""
    movies = [{"name": f"Filme {i}", "year": "2020"} for i in range(n_movies)]
    series = [{"name": f"Serie {i}", "releaseDate": "2019-01-01"} for i in range(n_series)]
    search_ids = {("movie", f"Filme {i}"): 10_000 + i for i in range(n_movies)}
    search_ids.update({("tv", f"Serie {i}"): 20_000 + i for i in range(n_series)})
    return fake_http(
        catalogs={"get_vod_streams": movies, "get_series": series},
        search_ids=search_ids,
        discover_ids={("movie", 8): [10_000 + i for i in range(n_movies)],
                      ("tv", 8): [20_000 + i for i in range(n_series)]},
    )


class TestMainSharpDropGuard(MainHarness, unittest.TestCase):
    """Catálogo Xtream truncado (lista válida, mas uma fração do real): as
    guardas de falha total não pegam, então o número de títulos casados de
    hoje é comparado, por tipo de mídia, com o da execução anterior (o
    vod-providers.json que o workflow deixa no diretório ao fazer checkout
    da branch vod-data)."""

    # Execução anterior saudável: bem acima do mínimo para comparar.
    LAST_GOOD = previous_file(500, 200)

    # (a) queda brusca num tipo de mídia -> erro, arquivo intocado
    def test_truncated_movie_catalog_aborts_without_writing(self):
        # 50 filmes casados hoje contra 500 ontem (10%) - painel instável.
        err = self.assert_aborted_without_writing(bulk_http(50, 200))
        self.assertIn("movie", err)
        self.assertIn("50", err)
        self.assertIn("500", err)

    def test_truncated_series_catalog_aborts_even_if_movies_are_fine(self):
        self.assert_aborted_without_writing(bulk_http(500, 10))

    def test_tiny_run_from_healthy_looking_sources_aborts(self):
        # O caso real do painel: fontes "saudáveis", só que 2 títulos casados.
        self.assert_aborted_without_writing(fake_http())

    # (b) contagem próxima ou maior -> grava, exit 0
    def test_count_close_to_previous_writes_the_file(self):
        self.run_main(bulk_http(400, 150))
        out = self.read_written()
        self.assertEqual(len(out["movies"]), 400)
        self.assertEqual(len(out["series"]), 150)

    def test_count_higher_than_previous_writes_the_file(self):
        self.run_main(bulk_http(900, 300))
        out = self.read_written()
        self.assertEqual(len(out["movies"]), 900)
        self.assertEqual(len(out["series"]), 300)

    def test_count_exactly_at_the_threshold_writes_the_file(self):
        movies = int(500 * bpm.MIN_MATCH_RATIO_VS_PREVIOUS)
        series = int(200 * bpm.MIN_MATCH_RATIO_VS_PREVIOUS)
        self.run_main(bulk_http(movies, series))
        self.assertEqual(len(self.read_written()["movies"]), movies)

    def test_previous_type_below_minimum_is_not_compared(self):
        # Ontem só 40 séries casadas (abaixo do mínimo para servir de
        # referência): hoje 2 (5%) não aborta, porque séries nem são comparadas.
        self.set_previous(previous_file(500, 40))
        self.run_main(bulk_http(450, 2))
        out = self.read_written()
        self.assertEqual(len(out["movies"]), 450)
        self.assertEqual(len(out["series"]), 2)

    # (c) sem arquivo anterior / só a semente -> comparação pulada
    def test_first_run_without_previous_file_writes_the_file(self):
        os.remove("vod-providers.json")
        self.run_main(fake_http())
        self.assertEqual(len(self.read_written()["movies"]), 2)

    def test_empty_seed_file_does_not_trigger_the_check(self):
        self.set_previous('{"generatedAt": null, "movies": {}, "series": {}}')
        self.run_main(fake_http())
        self.assertEqual(len(self.read_written()["series"]), 2)

    # (d) arquivo anterior ilegível/malformado -> comparação pulada, sem crash
    def test_unparseable_previous_file_is_skipped(self):
        self.set_previous('{"generatedAt": "ontem", "movies": {"x|2020": [')
        self.run_main(fake_http())
        self.assertEqual(len(self.read_written()["movies"]), 2)

    def test_previous_file_with_wrong_shape_is_skipped(self):
        for bad in ('[]', '"texto"', 'null', '{"movies": "x", "series": 42}',
                    '{"movies": ["a", "b"]}'):
            with self.subTest(previous=bad):
                self.set_previous(bad)
                self.run_main(fake_http())
                self.assertEqual(len(self.read_written()["movies"]), 2)

    def test_previous_file_with_invalid_utf8_is_skipped(self):
        with open("vod-providers.json", "wb") as f:
            f.write(b'\xff\xfe{"movies": \x80}')
        self.run_main(fake_http())
        self.assertEqual(len(self.read_written()["movies"]), 2)


if __name__ == "__main__":
    unittest.main()
