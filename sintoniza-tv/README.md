# Sintoniza IPTV — Smart TV (LG webOS + Samsung Tizen)

Reprodutor IPTV otimizado para Smart TV com suporte a HLS e MPEG-TS.

---

## Estrutura da pasta

```
sintoniza-tv/
├── sintoniza-tv.html   ← App principal (abre no browser da TV ou como app nativo)
├── tv-nav.js           ← Motor de navegação por controle remoto (D-pad)
├── tv-styles.css       ← Estilos 10-foot (1920×1080, fontes grandes)
├── icon.png            ← Ícone do app (512×512)
├── appinfo.json        ← Manifesto LG webOS (ares-package .)
├── config.xml          ← Manifesto Samsung Tizen (tizen package)
├── .tizen-project      ← Metadados do projeto Samsung Tizen
└── README.md           ← Guia de instalação passo a passo
```

> **Sobre a URL da lista M3U:**
> O app lê automaticamente a chave `sint_url` do `localStorage`, que é a **mesma**
> usada pelo app web `sintoniza.html`. Se você já configurou a lista no browser,
> a TV vai reconhecê-la automaticamente (em dispositivos que compartilham localStorage,
> como quando o app é servido do mesmo servidor).

---

## 🟥 LG webOS — Instalação (uso pessoal)

### Pré-requisitos (PC)
```bash
npm install -g @webos-tools/cli
ares -V   # deve exibir a versão
```

### 1. Ativar Developer Mode na TV LG

1. Baixe o app **"Developer Mode"** na LG Content Store
2. Abra o app, ligue o Developer Mode e anote o **IP da TV**
3. O Developer Mode expira em 50h — renove abrindo o app

### 2. Adicionar a TV ao CLI

```bash
ares-setup-device
```
Escolha **Add** → tipo **tv** → insira o IP da TV → confirme.

### 3. Empacotar

Execute dentro da pasta **raiz do projeto** (`sintoniza-tv/`):

```bash
ares-package .
```

Isso gera: `com.sintoniza.iptv_1.0.0_all.ipk`

### 4. Instalar na TV

```bash
ares-install com.sintoniza.iptv_1.0.0_all.ipk -d minhaTVLG
ares-launch com.sintoniza.iptv -d minhaTVLG
```

### 5. Testar sem TV física (Emulador)

```bash
ares-launch --device-list          # lista dispositivos
ares-launch com.sintoniza.iptv     # abre no simulador webOS
```

---

## 🔵 Samsung Tizen — Instalação (uso pessoal)

### Pré-requisitos (PC)

- **Tizen Studio** com extensões "Samsung TV Extensions" + "Samsung Certificate Extension"
- Download: https://developer.samsung.com/tizen-studio

### 1. Ativar Developer Mode na TV Samsung

1. Menu Samsung → **Apps**
2. Pressione **1-2-3-4-5** no controle remoto
3. Ligue o **Developer Mode** e insira o **IP do seu PC**
4. Reinicie a TV (segure o botão de energia)
5. O Developer Mode Samsung **não expira**

### 2. Criar Certificado (único por dispositivo)

No Tizen Studio:
- **Tools → Certificate Manager → +** → Samsung Certificate
- Siga o assistente (requer conta Samsung Developer — gratuita)

### 3. Importar projeto no Tizen Studio

1. **File → Import → Tizen → Tizen Project**
2. Selecione a pasta `sintoniza-tv/`
3. Tipo de projeto: **Web Application**

### 4. Instalar na TV

No Tizen Studio:
- Conecte à TV em **Tools → Device Manager** (insira IP da TV)
- Clique com botão direito no projeto → **Run As → Tizen Web Application**

Ou via CLI:
```bash
tizen package -t wgt -s MeuPerfil -- .
tizen install -n SintonizaIPTV.wgt -t minha-samsung-tv
```

---

## 🎮 Controles do app na TV

| Tecla no controle | Ação |
|---|---|
| ◄ ► ▲ ▼ | Navegar entre canais e abas |
| **OK / Enter** | Selecionar canal / confirmar |
| **Voltar / Back** | Voltar ao menu / abrir sidebar |
| **Botão vermelho** | — (futuro: EPG) |

---

## 🔧 Configuração da lista M3U

Ao abrir o app pela primeira vez:
1. A tela de **Onboarding** aparece pedindo a URL da sua lista
2. Cole a URL (ex: `http://meuservidor.com/lista.m3u`)
3. Pressione **OK** → o app carrega e salva a URL automaticamente
4. Nas próximas vezes, o app carrega a lista **automaticamente**

A URL fica salva no `localStorage` sob a chave `sint_url` —
a mesma chave do app web, garantindo compatibilidade.

---

## 📋 Requisitos de TV

| Plataforma | Versão mínima | Ano |
|---|---|---|
| LG webOS | 5.0+ | 2020+ |
| Samsung Tizen | 5.0+ | 2020+ |

TVs de 2020+ têm Chromium 68+ (webOS) ou Tizen 5.5+ (Samsung),
ambos com suporte estável a HLS.js e MSE para streams IPTV.

---

## 🚀 Tecnologias

- **HLS.js** — player HLS para LG webOS
- **webapis.avplay** — player nativo Samsung (Tizen)
- **mpegts.js** — player MPEG-TS (.ts direto)
- **Vanilla JS** — zero frameworks, máxima compatibilidade
- **Watchdog** — reconexão automática em caso de travamento
- **Buffer Progressivo** — 20s → 25s → 35s → 50s → 60s
