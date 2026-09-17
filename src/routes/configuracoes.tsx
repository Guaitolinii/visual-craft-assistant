import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FileUp, Link2, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({ meta: [
    { title: "Configurações — Sintoniza" },
    { name: "description", content: "Cadastre sua lista de canais autorizada e ajuste as preferências de reprodução." },
    { property: "og:title", content: "Configurações — Sintoniza" },
    { property: "og:description", content: "Cadastre sua lista autorizada e ajuste a reprodução." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Configuracoes,
});

const LS_URL_KEY = "sintoniza_list_url";
const LS_MODE_KEY = "sintoniza_list_mode";
const LS_QUALITY_KEY = "sintoniza_quality";
const LS_FIT_KEY = "sintoniza_fit";

function Configuracoes() {
  const [mode, setMode] = useState<"url" | "arquivo">("url");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [saved, setSaved] = useState(false);
  const [quality, setQuality] = useState("Auto");
  const [fit, setFit] = useState("Original");

  /** Carregar preferências salvas ao montar */
  useEffect(() => {
    const savedMode = localStorage.getItem(LS_MODE_KEY) as "url" | "arquivo" | null;
    const savedUrl = localStorage.getItem(LS_URL_KEY);
    const savedQuality = localStorage.getItem(LS_QUALITY_KEY);
    const savedFit = localStorage.getItem(LS_FIT_KEY);

    if (savedMode) setMode(savedMode);
    if (savedUrl) setUrl(savedUrl);
    if (savedQuality) setQuality(savedQuality);
    if (savedFit) setFit(savedFit);

    // Se havia URL salva anteriormente, marcar como salvo
    if (savedUrl && savedUrl.trim().length > 8) setSaved(true);
  }, []);

  const ready = mode === "url" ? url.trim().length > 8 : fileName.length > 0;

  const handleSave = () => {
    if (mode === "url") {
      localStorage.setItem(LS_URL_KEY, url);
      localStorage.setItem(LS_MODE_KEY, "url");
    } else {
      localStorage.setItem(LS_MODE_KEY, "arquivo");
    }
    setSaved(true);
  };

  const handleClear = () => {
    setUrl("");
    setFileName("");
    setSaved(false);
    localStorage.removeItem(LS_URL_KEY);
    localStorage.removeItem(LS_MODE_KEY);
  };

  const handleQualityChange = (value: string) => {
    setQuality(value);
    localStorage.setItem(LS_QUALITY_KEY, value);
  };

  const handleFitChange = (value: string) => {
    setFit(value);
    localStorage.setItem(LS_FIT_KEY, value);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} strokeWidth={1.8} /> Voltar ao catálogo
        </Link>

        <header className="mt-6">
          <p className="eyebrow">CONFIGURAÇÕES</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sua lista de canais</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Aqui você cadastra a lista que tem autorização para usar. Enquanto nada for cadastrado, o catálogo mostra
            conteúdo de demonstração.
          </p>
        </header>

        <section className="mt-8 rounded-lg border border-border bg-card p-5 sm:p-7">
          <div className="flex gap-2 rounded-md bg-secondary p-1">
            {(["url", "arquivo"] as const).map((item) => (
              <button
                key={item}
                onClick={() => { setMode(item); setSaved(false); }}
                className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${mode === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {item === "url" ? "Endereço da lista" : "Arquivo .m3u"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <label className="mt-6 block">
              <span className="text-sm font-medium">Endereço da lista</span>
              <span className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                <Link2 size={18} strokeWidth={1.8} className="text-muted-foreground" />
                <input
                  value={url}
                  onChange={(event) => { setUrl(event.target.value); setSaved(false); }}
                  placeholder="https://exemplo.com/minha-lista.m3u8"
                  className="w-full bg-transparent text-sm outline-none"
                  aria-label="Endereço da lista"
                />
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">
                Formatos aceitos: .m3u e .m3u8. Use apenas listas que você tem direito de reproduzir.
              </span>
            </label>
          ) : (
            <label className="mt-6 flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border bg-background px-4 py-10 text-center">
              <FileUp size={26} strokeWidth={1.8} className="text-primary" />
              <span className="text-sm font-medium">{fileName || "Escolher arquivo .m3u"}</span>
              <span className="text-xs text-muted-foreground">O arquivo fica só no seu aparelho até a conexão segura ser ativada.</span>
              <input
                type="file"
                accept=".m3u,.m3u8"
                className="sr-only"
                onChange={(event) => { setFileName(event.target.files?.[0]?.name ?? ""); setSaved(false); }}
              />
            </label>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button disabled={!ready} onClick={handleSave}>Guardar lista</Button>
            <Button variant="ghost" onClick={handleClear}>Limpar</Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-primary">
                <CheckCircle2 size={15} /> Lista salva — permanece ao recarregar.
              </span>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <article className="rounded-lg border border-border bg-card p-5">
            <Lock size={20} strokeWidth={1.8} className="text-primary" />
            <h2 className="mt-3 text-base font-semibold">Guardada com segurança</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Endereço, usuário e senha nunca aparecem na tela nem ficam salvos no navegador. Para valer de forma
              permanente, é preciso ligar o armazenamento seguro do servidor.
            </p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <ShieldCheck size={20} strokeWidth={1.8} className="text-primary" />
            <h2 className="mt-3 text-base font-semibold">Uso autorizado</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Só cadastre listas cuja reprodução você tem permissão para usar. Nada aqui contorna bloqueios ou
              proteções de conteúdo.
            </p>
          </article>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Preferências de reprodução</h2>
          <p className="mt-1 text-sm text-muted-foreground">As preferências são salvas automaticamente.</p>
          <div className="mt-4 space-y-4">
            <label className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">Qualidade inicial</span>
              <select
                value={quality}
                onChange={(event) => handleQualityChange(event.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Qualidade inicial"
              >
                {["Auto", "1080p", "720p"].map((opt) => <option key={opt}>{opt}</option>)}
              </select>
            </label>
            <label className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">Enquadramento padrão</span>
              <select
                value={fit}
                onChange={(event) => handleFitChange(event.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Enquadramento padrão"
              >
                {["Original", "Preencher", "Esticar"].map((opt) => <option key={opt}>{opt}</option>)}
              </select>
            </label>
          </div>
        </section>
      </main>
    </div>
  );
}
