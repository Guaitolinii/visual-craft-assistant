import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOtt, plain } from "./loadOtt.js";

test("o link de ativação leva ao painel com o código preenchido", () => {
  const o = loadOtt();
  assert.equal(o.ottActivationLink("https://sintonizatv.com.br/", "ABCD-1234"), "https://sintonizatv.com.br?codigo=ABCD-1234");
  assert.equal(o.ottActivationLink("sintonizatv.com.br", "ABCD-1234"), "https://sintonizatv.com.br?codigo=ABCD-1234");
  assert.equal(o.ottActivationLink("", "ABCD-1234"), "");
  assert.equal(o.ottActivationLink("https://x.com", ""), "");
});

test("o QR sai como um único caminho SVG", () => {
  const o = loadOtt();
  const qr = plain(o.ottQrSvgPath("https://sintonizatv.com.br?codigo=ABCD-1234"));
  assert.ok(qr.size >= 21 && qr.size <= 57);
  assert.match(qr.path, /^M\d+ \d+h1v1h-1z/);
  assert.deepEqual(plain(o.ottQrSvgPath("")), { size: 0, path: "" });
});
