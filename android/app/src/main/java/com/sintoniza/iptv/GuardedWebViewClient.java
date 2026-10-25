package com.sintoniza.iptv;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.HashMap;

// WebViewClient do Capacitor com a guarda do player incorporado (ver EmbedGuard). Com a guarda desligada
// tudo segue exatamente o comportamento padrão do Capacitor.
public class GuardedWebViewClient extends BridgeWebViewClient {
    public GuardedWebViewClient(Bridge bridge) {
        super(bridge);
    }

    // Anúncio: devolve resposta vazia em vez de baixar o script/imagem/quadro do anunciante
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (EmbedGuard.active && request != null && request.getUrl() != null
            && EmbedGuard.isAdHost(request.getUrl().getHost())) {
            return new WebResourceResponse(
                "text/plain", "UTF-8", 204, "No Content",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0])
            );
        }
        return super.shouldInterceptRequest(view, request);
    }

    // Popup e redirecionamento: window.open (sem suporte a várias janelas) e "top.location = ..." do player chegam aqui
    // como navegação do quadro principal. O padrão do Capacitor abriria o navegador do aparelho com o anúncio.
    // Durante o embed:
    //  - navegação dentro do próprio quadro do player (subframe) segue normal, sem abrir o navegador;
    //  - o único endereço de fora liberado é o do próprio player (botão "Abrir no navegador");
    //  - qualquer outra navegação do quadro principal é descartada.
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (!EmbedGuard.active) return super.shouldOverrideUrlLoading(view, request);
        if (!request.isForMainFrame()) return false;
        Uri url = request.getUrl();
        if (EmbedGuard.isAllowedExternal(url)) return super.shouldOverrideUrlLoading(view, request);
        return true;
    }
}
