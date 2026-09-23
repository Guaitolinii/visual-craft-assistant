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

    // Estado para saber se a janela foi fechada no "x" ou expandida de volta:
    // stopped = Activity parada (onStop sem onStart depois);
    // wasInPip = estava na janela flutuante e ainda não sabemos como ela saiu.
    private boolean stopped = false;
    private boolean wasInPip = false;

    // Avisa o JS para mostrar só o vídeo dentro da janela.
    // Ao sair: closed=true quando a Activity já parou (janela fechada no "x");
    // closed=false quando a janela voltou para tela cheia.
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (isInPictureInPictureMode) {
            wasInPip = true;
            sendPipEvent(true, false);
        } else if (stopped) {
            wasInPip = false;
            sendPipEvent(false, true);
        } else {
            // Ainda não parou: se o onStop vier logo em seguida, foi fechada
            sendPipEvent(false, false);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        stopped = false;
    }

    // Voltou para tela cheia (expandiu a janela): não foi fechamento.
    @Override
    public void onResume() {
        super.onResume();
        if (!isInPictureInPictureMode()) wasInPip = false;
    }

    // Janela fechada no "x" em aparelhos que avisam a saída do PiP antes do onStop.
    @Override
    public void onStop() {
        super.onStop();
        stopped = true;
        if (wasInPip && !isInPictureInPictureMode()) {
            wasInPip = false;
            sendPipEvent(false, true);
        }
    }

    // Dispara o evento "sintonizapip" na janela do WebView.
    private void sendPipEvent(boolean active, boolean closed) {
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("sintonizapip", "{ \"active\": " + active + ", \"closed\": " + closed + " }");
        }
    }
}
