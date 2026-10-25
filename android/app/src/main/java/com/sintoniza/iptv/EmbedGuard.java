package com.sintoniza.iptv;

import android.net.Uri;

// Guarda do player incorporado (embed): enquanto a tela de embed do app está aberta, o JS liga a guarda
// (SintonizaEmbedPlugin.setGuard). Com ela ligada, o GuardedWebViewClient:
//  - bloqueia requisições a domínios de anúncio (AD_DOMAINS);
//  - impede que o player abra janelas novas ou leve a tela inteira do app para outro site
//    (o Capacitor, por padrão, abriria o navegador do aparelho para qualquer endereço de fora do app).
final class EmbedGuard {
    private EmbedGuard() {}

    // Ligada enquanto a tela de embed está aberta
    static volatile boolean active = false;
    // Único endereço externo que pode abrir no navegador durante o embed: o do próprio player ("Abrir no navegador")
    static volatile String allowUrl = "";

    // Redes de anúncio de popup/popunder/banner mais comuns em players de terceiros. Só domínios que existem
    // exclusivamente para anunciar (nunca CDNs nem o Google, para não quebrar player legítimo).
    // Casa o domínio e qualquer subdomínio. Para ampliar, acrescente aqui e rode os testes.
    static final String[] AD_DOMAINS = {
        "adsterra.com",
        "highperformanceformat.com",
        "profitableratecpm.com",
        "effectivegatecpm.com",
        "popads.net",
        "popcash.net",
        "propellerads.com",
        "propellerclick.com",
        "onclickads.net",
        "exoclick.com",
        "exosrv.com",
        "juicyads.com",
        "trafficjunky.net",
        "clickadu.com",
        "hilltopads.net",
        "adcash.com",
        "a-ads.com",
        "admaven.com",
        "ad-maven.com",
        "monetag.com",
        "tsyndicate.com",
        "adsco.re",
        "richads.com",
        "clickaine.com",
        "bidvertiser.com",
        "revcontent.com",
    };

    // true se o host é um dos domínios de anúncio ou subdomínio deles
    static boolean isAdHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String h = host.toLowerCase();
        for (String domain : AD_DOMAINS) {
            if (h.equals(domain) || h.endsWith("." + domain)) return true;
        }
        return false;
    }

    // true se a URL é exatamente o endereço liberado pelo JS (mesmo host, caminho e consulta)
    static boolean isAllowedExternal(Uri url) {
        String allowed = allowUrl;
        if (url == null || allowed == null || allowed.isEmpty()) return false;
        Uri a = Uri.parse(allowed);
        return safeEquals(a.getScheme(), url.getScheme())
            && safeEquals(a.getHost(), url.getHost())
            && safeEquals(a.getPath(), url.getPath())
            && safeEquals(a.getQuery(), url.getQuery());
    }

    private static boolean safeEquals(String x, String y) {
        return x == null ? y == null : x.equalsIgnoreCase(y);
    }
}
