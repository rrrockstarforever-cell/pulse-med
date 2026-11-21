package com.abhijeet.pulsemed.mobile;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            // The window itself already shrinks above the keyboard, so adding the keyboard height here again left only a thin strip and a gray gap.
            v.setPadding(bars.left, bars.top, bars.right, ime.bottom > 0 ? 0 : bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
        // Back button: let the web app go to the previous screen or close a menu; only leave the app when it says 'exit'.
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) { moveTaskToBack(true); return; }
                getBridge().getWebView().evaluateJavascript(
                    "(function(){try{return window.__pmBack?window.__pmBack():'exit';}catch(e){return 'exit';}})()",
                    value -> {
                        if (value != null && value.contains("handled")) return;
                        moveTaskToBack(true);
                    });
            }
        });
        // Stop Android's stylus-handwriting sheet ("Try out your stylus", gray scrim) from opening when a text box is tapped.
        if (android.os.Build.VERSION.SDK_INT >= 34 && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setAutoHandwritingEnabled(false);
        }
        getWindow().getDecorView().setBackgroundColor(0xFF0F172A);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), content);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
