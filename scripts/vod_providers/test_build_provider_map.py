# scripts/vod_providers/test_build_provider_map.py
import unittest
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

if __name__ == "__main__":
    unittest.main()
