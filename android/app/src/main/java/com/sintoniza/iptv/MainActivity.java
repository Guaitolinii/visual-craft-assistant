package com.sintoniza.iptv;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import com.getcapacitor.BridgeActivity;
import java.util.Collections;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locais precisam ser registrados antes do super.onCreate
        registerPlugin(SintonizaPipPlugin.class);
        super.onCreate(savedInstanceState);
        // Reaplica a faixa de exclusão do gesto de voltar sempre que o layout muda (rotação, teclado, etc.)
        getWindow().getDecorView().addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int left, int top, int right, int bottom,
                                       int oldLeft, int oldTop, int oldRight, int oldBottom) {
                applyEdgeGestureExclusion();
            }
        });
    }

    // Arrastar da borda esquerda abre o menu lateral do app. No Android 10+ o gesto de voltar do
    // sistema usa essa mesma borda e roubaria o arrasto; então uma faixa fina da borda esquerda
    // (24 dp de largura, no meio da tela) fica fora da navegação por gesto. O Android só aceita até
    // 200 dp de altura de exclusão por borda; o restante da borda continua voltando normalmente.
    private void applyEdgeGestureExclusion() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        View root = getWindow().getDecorView();
        int width = root.getWidth();
        int height = root.getHeight();
        if (width <= 0 || height <= 0) return;
        float density = getResources().getDisplayMetrics().density;
        int stripWidth = Math.round(24 * density);
        int stripHeight = Math.min(height, Math.round(200 * density));
        int stripTop = (height - stripHeight) / 2;
        root.setSystemGestureExclusionRects(
            Collections.singletonList(new Rect(0, stripTop, stripWidth, stripTop + stripHeight))
        );
    }

    // Ao voltar o foco (ex.: depois da janela flutuante ou de um diálogo) reaplica a exclusão.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyEdgeGestureExclusion();
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
