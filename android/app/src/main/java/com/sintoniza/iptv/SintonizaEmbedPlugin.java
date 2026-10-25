package com.sintoniza.iptv;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Liga/desliga a guarda do player incorporado (bloqueio de popup, redirecionamento e anúncios).
// O JS liga ao abrir a tela de embed e desliga ao fechar.
@CapacitorPlugin(name = "SintonizaEmbed")
public class SintonizaEmbedPlugin extends Plugin {
    // active: liga/desliga; allowUrl: endereço do player que ainda pode abrir no navegador do aparelho
    @PluginMethod
    public void setGuard(PluginCall call) {
        EmbedGuard.allowUrl = call.getString("allowUrl", "");
        EmbedGuard.active = Boolean.TRUE.equals(call.getBoolean("active", false));
        call.resolve();
    }
}
