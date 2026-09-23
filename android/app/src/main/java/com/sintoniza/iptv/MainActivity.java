package com.sintoniza.iptv;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locais precisam ser registrados antes do super.onCreate
        registerPlugin(SintonizaPipPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Entra na janela flutuante 16:9 (Android 8+ com suporte do aparelho).
    static boolean enterPip(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        if (!activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .build();
            return activity.enterPictureInPictureMode(params);
        } catch (IllegalStateException e) {
            return false;
        }
    }

    // Saiu do app (início/recentes) com algo tocando: vira janela flutuante.
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (SintonizaPipPlugin.autoEnter) enterPip(this);
    }

    // Avisa o JS para mostrar só o vídeo dentro da janela (e pausar ao fechar).
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("sintonizapip", "{ \"active\": " + isInPictureInPictureMode + " }");
        }
    }
}
