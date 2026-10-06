// Verifica no Chrome a tela de perfis do celular ("Quem está assistindo?", editor, avatar do topo, saudação e menu).
// Conta e backend FINGIDOS: o fetch é trocado por um falso (preScript) que guarda a "conta" no localStorage da página
// (sobrevive aos reloads) e registra o corpo de cada RPC. Nenhum aparelho real é criado e o backend real não é tocado.
//   (a) 1 perfil entra direto (sem seletor) e a saudação mostra o nome; migra os dados antigos para o principal
//   (b) 3 perfis: o seletor aparece cedo (antes do app), só o focado anima; escolher outro recarrega com chaves sint_p<id8>_*
//   (c) o avatar do topo abre o seletor; criar, renomear, trocar avatar e excluir levam os corpos corretos; erro do servidor aparece
//   (d) perfil ativo excluído em outro aparelho: cai no principal e regrava o ativo
//   (e) sem rede: usa o cache; sem cache e sem conta: o app abre como antes
//   (f) sem conta (?noott=1): sem botão de perfil, saudação sem nome inventado, cartão de perfis escondido
// Uso: node scripts/dev/check-profiles-ui.mjs [pasta-das-capturas]  (as capturas são opcionais e não devem ser commitadas)
import { withPage } from "./cdp.mjs";
import { pathToFileURL } from "node:url";

const pasta = process.argv[2];
const falhas = [];
const confere = (ok, msg) => { if (!ok) { falhas.push(msg); console.error("✖ " + msg); } };

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const D = "dddddddd-4444-4444-8444-444444444444";
const E = "eeeeeeee-5555-4555-8555-555555555555";
const P = {
  A: { id: A, nome: "Ana", avatar: "padrao", padrao: true },
  B: { id: B, nome: "Bia", avatar: "pipoca", padrao: false },
  C: { id: C, nome: "Caio", avatar: "claquete", padrao: false },
  D: { id: D, nome: "Duda", avatar: "oculos3d", padrao: false },
  E: { id: E, nome: "Edu", avatar: "robotv", padrao: false },
};

// Backend falso + semeadura (feita UMA vez por página: os reloads do teste mantêm o estado)
function preScript(seed) {
  return `(() => {
    const J = (o, status) => ({ ok: !status || status < 400, status: status || 200, text: async () => JSON.stringify(o), json: async () => o });
    if (!localStorage.getItem("__seeded")) {
      const s = ${JSON.stringify(seed)};
      Object.keys(s.ls || {}).forEach(k => localStorage.setItem(k, s.ls[k]));
      Object.keys(s.ss || {}).forEach(k => sessionStorage.setItem(k, s.ss[k]));
      localStorage.setItem("__srv", JSON.stringify(s.srv || { perfis: [] }));
      localStorage.setItem("__log", "[]");
      localStorage.setItem("__seeded", "1");
    }
    // linha do tempo do seletor (o <script> do head deve marcar profile-open ainda com a página carregando)
    window.__gateLog = [];
    try {
      new MutationObserver(() => {
        const on = document.documentElement.classList.contains("profile-open"), l = window.__gateLog;
        if (!l.length || l[l.length - 1].on !== on) l.push({ on, rs: document.readyState });
      }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true });
    } catch (e) { /* sem observador: o teste do início cedo falha com mensagem clara */ }
    const uuid = () => { const h = () => Math.floor(Math.random() * 16).toString(16); let s = ""; for (let i = 0; i < 32; i++) s += h(); return s.slice(0,8)+"-"+s.slice(8,12)+"-4"+s.slice(13,16)+"-8"+s.slice(17,20)+"-"+s.slice(20); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      url = String(url);
      if (url.endsWith("/app-config.json")) return J({ url: "https://falso.supabase.co", anonKey: "chave-falsa" });
      if (!url.includes("/rest/v1/rpc/")) { if (["file:", "data:", "blob:"].some(p => url.startsWith(p))) return realFetch(url, init); throw new TypeError("rede bloqueada no teste: " + url); }
      const nome = url.split("/rpc/")[1];
      const body = JSON.parse(init.body || "{}");
      const log = JSON.parse(localStorage.getItem("__log") || "[]"); log.push({ nome, body }); localStorage.setItem("__log", JSON.stringify(log));
      const srv = JSON.parse(localStorage.getItem("__srv"));
      const grava = () => localStorage.setItem("__srv", JSON.stringify(srv));
      if (nome === "device_config") return J({ status: "ok", user: { nome: "Conta Teste", status: "active", acesso_fim: "2030-01-01" }, playlists: [] });
      if (nome === "perfil_list") { if (srv.fail) throw new TypeError("sem rede"); return J({ status: "ok", perfis: srv.perfis }); }
      if (nome === "perfil_save") {
        if (body.p_nome === "ERRO") return J({ message: "Limite de 5 perfis por conta." }, 400);
        let p;
        if (body.p_id) { p = srv.perfis.find(x => x.id === body.p_id); p.nome = body.p_nome; p.avatar = body.p_avatar; }
        else { p = { id: uuid(), nome: body.p_nome, avatar: body.p_avatar, padrao: false }; srv.perfis.push(p); }
        grava();
        return J({ status: "ok", perfil: p });
      }
      if (nome === "perfil_delete") { srv.perfis = srv.perfis.filter(x => x.id !== body.p_id); grava(); return J({ status: "ok" }); }
      return J({ status: "ok" });
    };
  })();`;
}

const base = (extra) => ({ "sint_ott_token": "token-falso", "sint_ott_last_ok": String(Date.now()), ...extra });
const cache = (...ps) => JSON.stringify(ps);
const url = (q) => pathToFileURL("sintoniza-link.html").href + q;

async function cena(titulo, seed, opts, fn) {
  console.log("— " + titulo);
  new Function(preScript(seed)); // lança SyntaxError se o fetch falso não puder ser instalado: nunca toca o backend real
  await withPage(url(opts.q || "?ott=1"), { native: opts.native !== false, width: opts.width, height: opts.height, preScript: preScript(seed) }, async (page) => {
    page.captura = async (nome) => { if (pasta) await page.screenshot(`${pasta}/${nome}.png`); };
    page.espera = async (expr, ms = 15000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) { try { if (await page.eval(expr)) return true; } catch (e) { /* página recarregando */ } await page.sleep(150); }
      return false;
    };
    page.rpcs = (nome) => page.eval(`JSON.parse(localStorage.getItem("__log") || "[]").filter(r => r.nome === ${JSON.stringify(nome)}).map(r => r.body)`);
    // espera o app carregar de novo depois de um location.reload() provocado pelo app
    page.recarregou = async (marca) => page.espera(`typeof window.__marca_${marca} === "undefined" && document.readyState === "complete" && typeof profileBoot === "function"`, 20000);
    await fn(page);
  });
}

const cartoes = (page) => page.eval(`[...document.querySelectorAll("#profile-grid .pg-card")].map(c => ({ id: c.dataset.id || "", add: !!c.dataset.add, nome: c.querySelector(".pg-name").textContent, foco: c.classList.contains("is-focus"), vivo: !!c.querySelector(".avatar-vivo") }))`);
const gateAberto = (page) => page.eval(`document.documentElement.classList.contains("profile-open") && getComputedStyle(document.getElementById("profile-gate")).display !== "none"`);
const clicaCartao = (page, id) => page.eval(`document.querySelector('#profile-grid .pg-card[data-id="${id}"]').click()`);

// ── (a) 1 perfil: entra direto, a saudação mostra o nome, os dados antigos viram do principal ──
await cena("1 perfil entra direto", {
  ls: base({ sint_fav: JSON.stringify(["Canal Antigo"]) }),
  srv: { perfis: [P.A] },
}, {}, async (page) => {
  const fechou = await page.espera(`activeProfileId() === "${A}" && !document.documentElement.classList.contains("profile-open") && typeof profileActive === "function" && document.getElementById("welcome-h1").textContent.indexOf("Ana") >= 0`, 25000);
  const r = await page.eval(`({ ativo: activeProfileId(), h1: document.getElementById("welcome-h1").textContent, nome: document.getElementById("user-name").textContent,
    migrado: localStorage.getItem("sint_paaaaaaaa_fav"), antigo: localStorage.getItem("sint_fav"), btn: !document.getElementById("profile-btn").hidden,
    cartaoVisivel: getComputedStyle(document.getElementById("profiles-card")).display !== "none", avatar: !!document.querySelector("#user-avatar .avatar-padrao"),
    cards: document.querySelectorAll("#profile-grid .pg-card").length })`);
  confere(fechou, "com 1 perfil o app deveria abrir direto, com o perfil ativo gravado: " + JSON.stringify(r));
  confere(/^(Bom dia|Boa tarde|Boa noite), Ana\.$/.test(r.h1), "a saudação deveria mostrar o nome do perfil: " + JSON.stringify(r.h1));
  confere(r.nome === "Ana" && r.avatar, "o menu lateral deveria mostrar o avatar e o nome do perfil: " + JSON.stringify(r));
  confere(r.migrado === JSON.stringify(["Canal Antigo"]) && r.antigo === JSON.stringify(["Canal Antigo"]), "os dados antigos deveriam ser copiados para o principal (e as antigas ficam): " + JSON.stringify(r));
  confere(r.btn, "o avatar do topo deveria aparecer com perfil ativo");
  confere(r.cartaoVisivel, "o cartão de perfis deveria aparecer nas Configurações com conta ativa");
  confere(!/Guaitolini/.test(await page.eval(`document.body.innerText`)), "o nome fixo Guaitolini não pode aparecer em lugar nenhum");
  await page.captura("perfis-1-topo");
  await page.eval(`document.getElementById("nav-settings-btn").click()`);
  await page.sleep(500);
  await page.eval(`document.getElementById("profiles-card").scrollIntoView()`);
  await page.sleep(300);
  await page.captura("perfis-12-configuracoes");
});

// ── (b) 3 perfis: seletor cedo, só o focado anima, escolher outro recarrega com chaves diferentes ──
await cena("3 perfis: seletor e troca", {
  ls: base({
    sint_profile_active: A, sint_profiles: cache(P.A, P.B, P.C), sint_profiles_migrated: "1",
    sint_paaaaaaaa_fav: JSON.stringify(["Canal da Ana"]), sint_pbbbbbbbb_fav: JSON.stringify(["Canal da Bia"]),
  }),
  srv: { perfis: [P.A, P.B, P.C] },
}, {}, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 3 && document.documentElement.classList.contains("profile-open")`, 25000);
  await page.sleep(900); // a entrada dos cartões termina
  const log = await page.eval(`window.__gateLog`);
  confere(log.some(l => l.on) && log.find(l => l.on).rs === "loading", "o seletor deveria ser marcado cedo (página ainda carregando), antes do app aparecer: " + JSON.stringify(log));
  const cs = await cartoes(page);
  confere(cs.length === 3 && cs.map(c => c.nome).join() === "Ana,Bia,Caio", "o seletor deveria listar Ana, Bia e Caio: " + JSON.stringify(cs));
  confere(cs.filter(c => c.vivo).length === 1 && cs.find(c => c.foco).id === A && cs.find(c => c.foco).vivo, "só o perfil em foco (o último usado, Ana) deveria animar: " + JSON.stringify(cs));
  const v = await page.eval(`({ app: getComputedStyle(document.querySelector(".page-shell")).visibility, titulo: document.getElementById("profile-title").textContent,
    nomes: document.querySelectorAll("#profile-gate .avatar-vivo").length, zGate: +getComputedStyle(document.getElementById("profile-gate")).zIndex, zOtt: +getComputedStyle(document.getElementById("ott-gate")).zIndex, zToast: +getComputedStyle(document.getElementById("toast")).zIndex })`);
  confere(v.app === "hidden", "o app não pode aparecer atrás do seletor: " + JSON.stringify(v));
  confere(v.titulo === "Quem está assistindo?", "título do seletor: " + v.titulo);
  confere(v.zGate < v.zOtt && v.zGate > v.zToast && v.zGate > 99999, "z-index do seletor deveria ficar entre o toast/tela cheia e o ott-gate: " + JSON.stringify(v));
  await page.captura("perfis-2-seletor-3");
  // escolher a Bia: recarrega com outras chaves; o seletor não volta (variável de sessão) e o Canal da Bia é o favorito
  await page.eval(`window.__marca_troca = 1; document.querySelector('#profile-grid .pg-card[data-id="${B}"]').click()`);
  const trocou = await page.recarregou("troca");
  await page.espera(`activeProfileId() === "${B}" && document.getElementById("welcome-h1").textContent.indexOf("Bia") >= 0`, 15000);
  await page.sleep(1500); // dá tempo de o profileBoot da nova página terminar (não pode perguntar de novo)
  const r = await page.eval(`({ ativo: activeProfileId(), chave: profKey("sint_fav"), favs: _state.favorites, aberto: document.documentElement.classList.contains("profile-open"),
    h1: document.getElementById("welcome-h1").textContent, nome: document.getElementById("user-name").textContent })`);
  confere(trocou && r.ativo === B && r.chave === "sint_pbbbbbbbb_fav", "escolher a Bia deveria recarregar com a chave sint_pbbbbbbbb_fav: " + JSON.stringify(r));
  confere(JSON.stringify(r.favs) === JSON.stringify(["Canal da Bia"]), "os favoritos deveriam ser os da Bia, não os da Ana: " + JSON.stringify(r.favs));
  confere(!r.aberto, "depois de escolher, a revalidação não pode perguntar de novo: " + JSON.stringify(r));
  confere(/, Bia\.$/.test(r.h1) && r.nome === "Bia", "saudação e menu deveriam mostrar a Bia: " + JSON.stringify(r));
  const listas = await page.rpcs("perfil_list");
  confere(listas.length >= 2 && listas.every(b => b.p_token === "token-falso" && b.p_auto_criar === false && Object.keys(b).join() === "p_token,p_auto_criar"), "perfil_list deveria levar o token e p_auto_criar:false (o servidor não cria o perfil sozinho): " + JSON.stringify(listas));

  // ── (c1) o avatar do topo abre o seletor (e dá para fechar sem escolher) ──
  await page.eval(`document.getElementById("profile-btn").click()`);
  await page.sleep(900);
  const aberto = await gateAberto(page);
  const fecha = await page.eval(`!document.getElementById("profile-close-btn").hidden`);
  const cs2 = await cartoes(page);
  confere(aberto && fecha, "o avatar do topo deveria abrir o seletor com botão de fechar");
  confere(cs2.find(c => c.foco) && cs2.find(c => c.foco).id === B, "no seletor aberto pelo topo o foco deveria estar na Bia (ativa): " + JSON.stringify(cs2));
  await page.captura("perfis-3-seletor-aberto-pelo-topo");
  await page.eval(`document.getElementById("profile-close-btn").click()`);
  confere(!(await gateAberto(page)), "o botão de fechar deveria fechar o seletor");
  // menu lateral: avatar e nome do perfil; tocar abre o seletor
  await page.eval(`openSidebar()`);
  await page.sleep(500);
  await page.captura("perfis-4-menu-lateral");
  await page.eval(`document.getElementById("user-card").click()`);
  await page.sleep(300);
  confere(await gateAberto(page), "tocar no cartão do menu deveria abrir o seletor");
  confere(!(await page.eval(`document.getElementById("sidebar").classList.contains("open")`)), "o menu deveria fechar ao abrir o seletor");
  await page.eval(`document.getElementById("profile-close-btn").click()`);
});

// ── (c2) gerenciar: criar, renomear, trocar avatar, excluir ──
await cena("gerenciar perfis", {
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B, P.C), sint_profiles_migrated: "1", sint_pcccccccc_fav: JSON.stringify(["Canal do Caio"]), sint_pcccccccc_mylist: "[]" }),
  ss: { sint_profile_chosen: "1" },
  srv: { perfis: [P.A, P.B, P.C] },
}, {}, async (page) => {
  await page.espera(`activeProfileId() === "${A}" && typeof profileBoot === "function" && !_profile.booting && !document.getElementById("profile-btn").hidden`, 25000);
  confere(!(await gateAberto(page)), "já escolhido nesta sessão: o seletor não pode abrir sozinho");
  // abre pelo cartão das Configurações (modo gerenciar)
  await page.eval(`document.getElementById("profiles-card-manage").click()`);
  await page.sleep(900);
  let cs = await cartoes(page);
  confere(cs.length === 4 && cs[3].add && cs.slice(0, 3).every(c => !c.add), "o modo gerenciar deveria mostrar os 3 perfis + Adicionar perfil: " + JSON.stringify(cs));
  confere(await page.eval(`document.getElementById("profile-gate").classList.contains("is-manage") && document.getElementById("profile-title").textContent === "Gerenciar perfis"`), "o modo gerenciar deveria estar ligado");
  await page.captura("perfis-5-gerenciar");

  // criar "Duda" com o avatar trofeu
  await page.eval(`document.querySelector("#profile-grid .pg-add").click()`);
  await page.sleep(500);
  const ed = await page.eval(`({ titulo: document.getElementById("profile-editor-title").textContent, maxlength: document.getElementById("profile-name-input").maxLength,
    avatares: document.querySelectorAll("#profile-avatar-grid .pe-av").length, excluir: !document.getElementById("profile-delete-btn").hidden, vivos: document.querySelectorAll("#profile-avatar-grid .avatar-vivo").length })`);
  confere(ed.titulo === "Novo perfil" && ed.maxlength === 20 && ed.avatares === 12 && !ed.excluir && ed.vivos === 1, "editor de perfil novo: " + JSON.stringify(ed));
  await page.eval(`document.querySelector('#profile-avatar-grid .pe-av[data-av="trofeu"]').click(); var inp = document.getElementById("profile-name-input"); inp.value = "Duda"; inp.dispatchEvent(new Event("input"))`);
  confere((await page.eval(`document.querySelectorAll("#profile-avatar-grid .avatar-vivo").length`)) === 1 && (await page.eval(`document.querySelector("#profile-avatar-grid .is-selected").dataset.av`)) === "trofeu", "só o avatar escolhido deveria ficar selecionado e animado");
  await page.sleep(700);
  await page.captura("perfis-6-editor");
  await page.eval(`document.getElementById("profile-save-btn").click()`);
  await page.espera(`document.getElementById("profile-picker") && !document.getElementById("profile-picker").hidden`, 5000);
  let saves = await page.rpcs("perfil_save");
  confere(saves.length === 1 && JSON.stringify(saves[0]) === JSON.stringify({ p_token: "token-falso", p_id: null, p_nome: "Duda", p_avatar: "trofeu" }), "criar deveria chamar perfil_save com p_id nulo: " + JSON.stringify(saves));
  cs = await cartoes(page);
  confere(cs.length === 5 && cs[3].nome === "Duda" && cs[4].add, "com 4 perfis o cartão Adicionar continua: " + JSON.stringify(cs));
  // o 5º perfil: depois dele o cartão Adicionar some (limite de 5)
  await page.eval(`document.querySelector("#profile-grid .pg-add").click()`);
  await page.eval(`document.querySelector('#profile-avatar-grid .pe-av[data-av="robotv"]').click(); var inp = document.getElementById("profile-name-input"); inp.value = "Edu"; inp.dispatchEvent(new Event("input")); document.getElementById("profile-save-btn").click()`);
  await page.espera(`!document.getElementById("profile-picker").hidden`, 5000);
  cs = await cartoes(page);
  confere(cs.length === 5 && cs.every(c => !c.add) && cs[4].nome === "Edu", "com 5 perfis o cartão Adicionar some: " + JSON.stringify(cs));
  saves = await page.rpcs("perfil_save");
  confere(saves.length === 2 && saves[1].p_nome === "Edu" && saves[1].p_id === null, "o 5º perfil também sai com p_id nulo");
  await page.captura("perfis-7-gerenciar-5");
  const dudaId = cs[3].id;

  // renomear a Bia + trocar o avatar
  await clicaCartao(page, B);
  await page.sleep(400);
  const ed2 = await page.eval(`({ titulo: document.getElementById("profile-editor-title").textContent, nome: document.getElementById("profile-name-input").value, sel: document.querySelector("#profile-avatar-grid .is-selected").dataset.av, excluir: !document.getElementById("profile-delete-btn").hidden })`);
  confere(ed2.titulo === "Editar perfil" && ed2.nome === "Bia" && ed2.sel === "pipoca" && ed2.excluir, "editor da Bia: " + JSON.stringify(ed2));
  await page.eval(`document.querySelector('#profile-avatar-grid .pe-av[data-av="rolo"]').click(); var inp = document.getElementById("profile-name-input"); inp.value = "Bia Souza"; inp.dispatchEvent(new Event("input"))`);
  await page.eval(`document.getElementById("profile-save-btn").click()`);
  await page.espera(`!document.getElementById("profile-picker").hidden`, 5000);
  saves = await page.rpcs("perfil_save");
  confere(saves.length === 3 && JSON.stringify(saves[2]) === JSON.stringify({ p_token: "token-falso", p_id: B, p_nome: "Bia Souza", p_avatar: "rolo" }), "renomear deveria chamar perfil_save com o id e o novo avatar: " + JSON.stringify(saves[2]));
  confere((await cartoes(page))[1].nome === "Bia Souza", "o cartão deveria mostrar o novo nome");

  // o perfil principal não pode ser excluído
  await clicaCartao(page, A);
  await page.sleep(300);
  confere(await page.eval(`document.getElementById("profile-delete-btn").hidden`), "o botão Excluir deveria sumir no perfil principal");
  await page.eval(`document.getElementById("profile-cancel-btn").click()`);

  // nome vazio não chama o servidor; erro do servidor aparece
  await page.eval(`document.querySelector("#profile-grid .pg-card[data-id='${C}']").click()`);
  await page.eval(`var inp = document.getElementById("profile-name-input"); inp.value = "  "; inp.dispatchEvent(new Event("input")); document.getElementById("profile-save-btn").click()`);
  await page.sleep(300);
  confere(/nome/i.test(await page.eval(`document.getElementById("profile-error").textContent`)) && (await page.rpcs("perfil_save")).length === 3, "nome vazio deveria dar erro sem chamar o servidor");
  await page.eval(`var inp = document.getElementById("profile-name-input"); inp.value = "ERRO"; inp.dispatchEvent(new Event("input")); document.getElementById("profile-save-btn").click()`);
  await page.espera(`document.getElementById("profile-error").textContent.indexOf("Limite de 5") >= 0`, 5000);
  confere(/Limite de 5 perfis/.test(await page.eval(`document.getElementById("profile-error").textContent`)), "o erro do servidor deveria aparecer no editor");
  confere(!(await page.eval(`document.getElementById("profile-editor").hidden`)), "com erro o editor deveria continuar aberto");
  await page.captura("perfis-8-editor-erro");
  await page.eval(`document.getElementById("profile-cancel-btn").click()`);

  // excluir a Duda (com confirmação); as chaves dela neste aparelho saem
  await page.eval(`localStorage.setItem("sint_p${dudaId.slice(0, 8)}_fav", "[1]")`);
  await clicaCartao(page, dudaId);
  await page.eval(`document.getElementById("profile-delete-btn").click()`);
  confere(!(await page.eval(`document.getElementById("profile-delete-confirm").hidden`)) && (await page.rpcs("perfil_delete")).length === 0, "excluir deveria pedir confirmação antes de chamar o servidor");
  await page.eval(`document.getElementById("profile-delete-no").click()`);
  confere((await page.rpcs("perfil_delete")).length === 0 && await page.eval(`document.getElementById("profile-delete-confirm").hidden`), "voltar da confirmação não pode excluir");
  await page.eval(`document.getElementById("profile-delete-btn").click(); document.getElementById("profile-delete-yes").click()`);
  await page.espera(`!document.getElementById("profile-picker").hidden`, 5000);
  const dels = await page.rpcs("perfil_delete");
  confere(dels.length === 1 && JSON.stringify(dels[0]) === JSON.stringify({ p_token: "token-falso", p_id: dudaId }), "excluir deveria chamar perfil_delete com o id: " + JSON.stringify(dels));
  cs = await cartoes(page);
  confere(cs.length === 5 && cs[4].add && cs[3].nome === "Edu", "depois de excluir, o cartão Adicionar volta: " + JSON.stringify(cs));
  confere((await page.eval(`localStorage.getItem("sint_p${dudaId.slice(0, 8)}_fav")`)) === null, "os dados locais do perfil excluído deveriam sair do aparelho");
  confere(JSON.stringify(await page.eval(`JSON.parse(localStorage.getItem("sint_profiles")).map(p => p.nome)`)) === JSON.stringify(["Ana", "Bia Souza", "Caio", "Edu"]), "o cache de perfis deveria acompanhar");

  // excluir o perfil ATIVO: volta para o principal (a página abriu com a Ana, então não precisa recarregar)
  await page.eval(`localStorage.setItem("sint_profile_active", "${C}")`);
  await clicaCartao(page, C);
  await page.eval(`document.getElementById("profile-delete-btn").click(); document.getElementById("profile-delete-yes").click()`);
  const voltou = await page.espera(`activeProfileId() === "${A}" && !document.documentElement.classList.contains("profile-open")`, 8000);
  confere(voltou, "excluir o perfil ativo deveria cair no principal e fechar o seletor");
});

// ── (d) perfil ativo excluído em outro aparelho ──
await cena("ativo excluído em outro aparelho (sessão já escolhida)", {
  ls: base({ sint_profile_active: D, sint_profiles: cache(P.A, P.B, P.D), sint_profiles_migrated: "1", sint_paaaaaaaa_fav: JSON.stringify(["Canal da Ana"]), sint_pdddddddd_fav: JSON.stringify(["Canal da Duda"]) }),
  ss: { sint_profile_chosen: "1" },
  srv: { perfis: [P.A, P.B] },   // a Duda foi excluída por outro aparelho
}, {}, async (page) => {
  const ok = await page.espera(`activeProfileId() === "${A}" && typeof profileBoot === "function" && JSON.stringify(_state.favorites) === '["Canal da Ana"]'`, 25000);
  const r = await page.eval(`({ ativo: activeProfileId(), favs: _state.favorites, h1: document.getElementById("welcome-h1").textContent, aberto: document.documentElement.classList.contains("profile-open") })`);
  confere(ok && r.ativo === A, "com o ativo excluído em outro aparelho deveria cair no principal (regravando o ativo e recarregando): " + JSON.stringify(r));
  confere(/, Ana\.$/.test(r.h1) && !r.aberto, "saudação deveria ser a do principal, sem perguntar: " + JSON.stringify(r));
});
await cena("ativo excluído em outro aparelho (abertura: pergunta, sugere o principal)", {
  ls: base({ sint_profile_active: D, sint_profiles: cache(P.A, P.B, P.D), sint_profiles_migrated: "1" }),
  srv: { perfis: [P.A, P.B] },
}, {}, async (page) => {
  await page.espera(`activeProfileId() === "${A}" && document.querySelectorAll("#profile-grid .pg-card").length === 2`, 25000);
  const cs = await cartoes(page);
  confere(cs.length === 2 && cs.find(c => c.foco).id === A, "o seletor deveria listar só os perfis da conta e sugerir o principal: " + JSON.stringify(cs));
  confere((await page.eval(`activeProfileId()`)) === A, "o ativo local deveria ser regravado no principal");
  await page.eval(`window.__marca_x = 1; document.querySelector('#profile-grid .pg-card[data-id="${A}"]').click()`);
  confere(await page.recarregou("x"), "escolher o principal deveria recarregar (a página abriu com os dados do perfil excluído)");
});

// ── (e) sem rede ──
await cena("sem rede: usa o cache", {
  ls: base({ sint_profile_active: A, sint_profiles: cache(P.A, P.B), sint_profiles_migrated: "1" }),
  srv: { perfis: [P.A, P.B], fail: true },
}, {}, async (page) => {
  await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 2`, 25000);
  await page.sleep(800);
  confere(await gateAberto(page), "sem rede, o seletor deveria vir do cache");
});
await cena("sem rede e sem cache: o app abre como antes", {
  ls: base({}),
  srv: { perfis: [], fail: true },
}, {}, async (page) => {
  await page.espera(`typeof profileBoot === "function" && !_profile.booting && document.body.classList.contains("ott-mode")`, 25000);
  await page.sleep(600);
  const r = await page.eval(`({ ativo: activeProfileId(), aberto: document.documentElement.classList.contains("profile-open"), btn: !document.getElementById("profile-btn").hidden, h1: document.getElementById("welcome-h1").textContent })`);
  confere(r.ativo === null && !r.aberto && !r.btn, "sem rede e sem cache o app deveria abrir sem perfil e sem seletor: " + JSON.stringify(r));
});

// ── (f) sem conta: nada muda ──
await cena("sem conta (?noott=1)", { ls: {}, srv: { perfis: [P.A, P.B] } }, { q: "?noott=1", native: false }, async (page) => {
  const r = await page.eval(`({ h1: document.getElementById("welcome-h1").textContent, nome: document.getElementById("user-name").textContent, btn: !document.getElementById("profile-btn").hidden,
    gate: getComputedStyle(document.getElementById("profile-gate")).display, aberto: document.documentElement.classList.contains("profile-open"),
    cartao: getComputedStyle(document.getElementById("profiles-card")).display, ativo: activeProfileId() })`);
  confere(/^(Bom dia|Boa tarde|Boa noite)$/.test(r.h1), "sem conta a saudação deveria ser só 'Boa noite' (sem nome inventado): " + JSON.stringify(r.h1));
  confere(r.nome === "Convidado" && !r.btn && r.gate === "none" && !r.aberto && r.cartao === "none" && r.ativo === null, "sem conta não pode haver perfil, seletor nem cartão de perfis: " + JSON.stringify(r));
  confere((await page.rpcs("perfil_list")).length === 0, "sem conta não pode chamar perfil_list");
});

// ── capturas extras: 5 perfis (celular e tela larga) ──
if (pasta) {
  const cinco = { ls: base({ sint_profile_active: B, sint_profiles: cache(P.A, P.B, P.C, P.D, P.E), sint_profiles_migrated: "1" }), srv: { perfis: [P.A, P.B, P.C, P.D, P.E] } };
  await cena("captura: 5 perfis (celular)", cinco, {}, async (page) => { await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 5`, 25000); await page.sleep(1200); await page.captura("perfis-9-seletor-5"); });
  await cena("captura: 3 perfis (celular pequeno)", { ls: cinco.ls, srv: cinco.srv }, { width: 360, height: 640 }, async (page) => { await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 5`, 25000); await page.sleep(1200); await page.captura("perfis-10-seletor-360"); });
  await cena("captura: tela larga", cinco, { width: 1100, height: 700 }, async (page) => { await page.espera(`document.querySelectorAll("#profile-grid .pg-card").length === 5`, 25000); await page.sleep(1200); await page.captura("perfis-11-seletor-largo"); });
}

if (falhas.length) { console.error("✖ " + falhas.length + " verificação(ões) falharam"); process.exit(1); }
console.log("✔ ok");
