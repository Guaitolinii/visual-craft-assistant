import { createFileRoute } from "@tanstack/react-router";
import {
  Bell, ChevronDown, Clapperboard, Clock3, Expand, Film, Grid2X2,
  Heart, Home, ListVideo, Maximize, Menu, MonitorPlay, Newspaper,
  Pause, Play, Search, Settings, Star, Tv, UserRound, Volume2, VolumeX, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Sintoniza — Catálogo de TV" },
    { name: "description", content: "Navegue por canais, filmes e esportes e organize seus favoritos." },
    { property: "og:title", content: "Sintoniza — Catálogo de TV" },
    { property: "og:description", content: "Sua programação favorita, simples de encontrar e assistir." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

type Channel = { id: number; name: string; category: string; initials: string; color: string; status: string; live?: boolean; progress?: number };

const channels: Channel[] = [
  { id: 1, name: "TV Brasil", category: "TV aberta", initials: "TV", color: "logo-olive", status: "Brasil em pauta", live: true },
  { id: 2, name: "Arena Sports", category: "Esportes", initials: "AS", color: "logo-red", status: "Futebol ao vivo", live: true },
  { id: 3, name: "Notícia 24", category: "Notícias", initials: "N24", color: "logo-blue", status: "Jornal da noite", live: true },
  { id: 4, name: "Cine Brasil", category: "Filmes", initials: "CB", color: "logo-gold", status: "O som do tempo", progress: 64 },
  { id: 5, name: "Mundo Doc", category: "Filmes", initials: "MD", color: "logo-green", status: "Cidades invisíveis", progress: 28 },
  { id: 6, name: "Rede Cultura", category: "TV aberta", initials: "RC", color: "logo-plum", status: "Cultura livre", live: true },
  { id: 7, name: "Canal Um", category: "TV aberta", initials: "1", color: "logo-sand", status: "Programação nacional", live: true },
  { id: 8, name: "Esporte Total", category: "Esportes", initials: "ET", color: "logo-copper", status: "Mesa redonda", live: true },
];

const nav = [
  ["Início", Home], ["Favoritos", Heart], ["Filmes", Film], ["Esportes", Star],
  ["TV aberta", Tv], ["Notícias", Newspaper], ["Todos os canais", ListVideo], ["Recentes", Clock3],
] as const;

function Index() {
  const [active, setActive] = useState("Início");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<number[]>([2, 4]);
  const [selected, setSelected] = useState(channels[0]);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fit, setFit] = useState<"Original" | "Preencher" | "Esticar">("Original");
  const [menuOpen, setMenuOpen] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => channels.filter((channel) => {
    const matchesQuery = `${channel.name} ${channel.category} ${channel.status}`.toLowerCase().includes(query.toLowerCase());
    const matchesSection = active === "Início" || active === "Todos os canais" || active === "Recentes" ||
      (active === "Favoritos" ? favorites.includes(channel.id) : channel.category === active);
    return matchesQuery && matchesSection;
  }), [active, favorites, query]);

  const toggleFavorite = (id: number) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const fullscreen = async () => { if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen(); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="flex h-20 items-center gap-3 border-b border-border px-6">
          <div className="brand-mark"><MonitorPlay size={22} /></div>
          <div><p className="text-lg font-semibold">Sintoniza</p><p className="text-xs text-muted-foreground">TV do seu jeito</p></div>
          <Button variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X size={20} /></Button>
        </div>
        <nav className="flex-1 p-4" aria-label="Navegação principal">
          <p className="nav-label">CATÁLOGO</p>
          {nav.map(([label, Icon]) => <button key={label} className={`nav-item ${active === label ? "nav-active" : ""}`} onClick={() => { setActive(label); setMenuOpen(false); }}><Icon size={19} strokeWidth={1.8} /><span>{label}</span>{label === "Favoritos" && <span className="nav-count">{favorites.length}</span>}</button>)}
        </nav>
        <div className="border-t border-border p-4">
          <button className="nav-item"><Settings size={19} /><span>Configurações</span></button>
          <div className="mt-3 flex items-center gap-3 rounded-md bg-secondary p-3"><div className="avatar">GA</div><div className="min-w-0"><p className="truncate text-sm font-medium">Guaitolini</p><p className="text-xs text-muted-foreground">Plano pessoal</p></div><ChevronDown className="ml-auto" size={16} /></div>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}><Menu size={22} /></Button>
          <label className="search-box"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar canais, filmes ou programas..." aria-label="Buscar catálogo" />{query && <button onClick={() => setQuery("")} aria-label="Limpar busca"><X size={16} /></button>}</label>
          <Button variant="icon" size="icon" aria-label="Notificações"><Bell size={19} /></Button>
          <Button variant="icon" size="icon" aria-label="Perfil"><UserRound size={19} /></Button>
        </header>

        <div className="content-shell">
          <section className="welcome-row">
            <div><p className="eyebrow">QUARTA, 16 DE SETEMBRO</p><h1>Boa noite, <span>Guaitolini.</span></h1><p className="mt-2 text-muted-foreground">O que você quer assistir agora?</p></div>
            <div className="status-pill"><span className="status-dot" /> Catálogo atualizado</div>
          </section>

          <section className="feature-layout">
            <div ref={playerRef} className="player-stage">
              <div className={`player-art ${playing ? "is-playing" : ""}`}>
                <div className="signal-lines" />
                <div className="channel-monogram">{selected.initials}</div>
                <div className="player-copy"><span className="live-badge">{selected.live ? "● AO VIVO" : "FILME"}</span><h2>{selected.name}</h2><p>{selected.status}</p></div>
                {!playing && <Button className="play-center" size="icon" aria-label="Reproduzir" onClick={() => setPlaying(true)}><Play size={28} fill="currentColor" /></Button>}
              </div>
              <div className="player-controls">
                <Button variant="ghost" size="icon" aria-label={playing ? "Pausar" : "Reproduzir"} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</Button>
                <Button variant="ghost" size="icon" aria-label={muted ? "Ativar som" : "Silenciar"} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</Button>
                <div className="live-line"><span /></div><span className="hidden text-xs font-medium text-primary sm:inline">AO VIVO</span>
                <select aria-label="Qualidade"><option>Auto</option><option>1080p</option><option>720p</option></select>
                <select value={fit} onChange={(event) => setFit(event.target.value as typeof fit)} aria-label="Modo de enquadramento"><option>Original</option><option>Preencher</option><option>Esticar</option></select>
                <Button variant="ghost" size="icon" aria-label="Tela cheia" onClick={fullscreen}><Maximize size={20} /></Button>
              </div>
            </div>

            <aside className="on-now">
              <div className="flex items-center justify-between"><div><p className="eyebrow">A SEGUIR</p><h2 className="mt-1 text-xl font-semibold">No ar agora</h2></div><Clapperboard className="text-primary" size={24} /></div>
              <div className="now-list">{channels.slice(1, 5).map((channel) => <button key={channel.id} className="now-row" onClick={() => { setSelected(channel); setPlaying(false); }}><span className={`mini-logo ${channel.color}`}>{channel.initials}</span><span className="min-w-0 flex-1 text-left"><strong>{channel.name}</strong><small>{channel.status}</small></span><Play size={16} /></button>)}</div>
            </aside>
          </section>

          <section className="catalog-section">
            <div className="section-heading"><div><p className="eyebrow">EXPLORE</p><h2>{query ? `Resultados para “${query}”` : active}</h2></div><div className="view-toggle"><Button variant="secondary" size="icon" aria-label="Visualização em grade"><Grid2X2 size={18} /></Button><Button variant="ghost" size="icon" aria-label="Visualização em lista"><ListVideo size={19} /></Button></div></div>
            {visible.length > 0 ? <div className="channel-grid">{visible.map((channel) => <article key={channel.id} className={`channel-card ${selected.id === channel.id ? "selected-card" : ""}`}>
              <button className="card-main" onClick={() => { setSelected(channel); setPlaying(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Assistir ${channel.name}`}>
                <div className={`channel-logo ${channel.color}`}><span>{channel.initials}</span><div className="logo-ring" /></div>
                <div className="card-tags"><span>{channel.live ? "● AO VIVO" : "FILME"}</span><span>{channel.category}</span></div>
                <div><h3>{channel.name}</h3><p>{channel.status}</p></div>
                {channel.progress && <div className="progress"><span style={{ width: `${channel.progress}%` }} /></div>}
              </button>
              <Button variant="ghost" size="icon" className="favorite-button" aria-label={favorites.includes(channel.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={() => toggleFavorite(channel.id)}><Heart size={19} fill={favorites.includes(channel.id) ? "currentColor" : "none"} /></Button>
            </article>)}</div> : <div className="empty-state"><Search size={30} /><h3>Nenhum conteúdo encontrado</h3><p>Tente outro termo ou escolha uma categoria diferente.</p></div>}
          </section>
        </div>
      </main>
      {menuOpen && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
      <nav className="mobile-tabs" aria-label="Atalhos"><button className={active === "Início" ? "mobile-active" : ""} onClick={() => setActive("Início")}><Home /><span>Início</span></button><button className={active === "Favoritos" ? "mobile-active" : ""} onClick={() => setActive("Favoritos")}><Heart /><span>Favoritos</span></button><button className={active === "Filmes" ? "mobile-active" : ""} onClick={() => setActive("Filmes")}><Film /><span>Filmes</span></button><button onClick={() => setMenuOpen(true)}><Menu /><span>Mais</span></button></nav>
    </div>
  );
}
