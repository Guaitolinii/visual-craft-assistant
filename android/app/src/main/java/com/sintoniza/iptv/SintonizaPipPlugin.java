package com.sintoniza.iptv;

import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Janela flutuante (Picture-in-Picture) do Sintoniza: o JS liga o modo
// automático enquanto algo toca; ao sair do app, a MainActivity entra em PiP.
@CapacitorPlugin(name = "SintonizaPip")
public class SintonizaPipPlugin extends Plugin {
    static volatile boolean autoEnter = false;

    // Liga/desliga a entrada automática na janela flutuante ao sair do app.
    @PluginMethod
    public void setAutoEnter(PluginCall call) {
        autoEnter = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    // Informa se o aparelho suporta janela flutuante (Android 8+ com o recurso).
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getActivity().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE));
        call.resolve(ret);
    }

    // Entra na janela flutuante agora (botão do player).
    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (MainActivity.enterPip(getActivity())) call.resolve();
            else call.reject("Janela flutuante indisponível neste aparelho");
        });
    }
}
