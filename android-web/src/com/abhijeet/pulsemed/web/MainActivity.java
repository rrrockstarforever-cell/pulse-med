package com.abhijeet.pulsemed.web;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
public class MainActivity extends Activity {
    private static final String PREFS = "pulse", KEY_URL = "url";
    private static final int FILE_CHOOSER_REQUEST = 1;
    private SharedPreferences prefs;
    private WebView webView;
    private String savedUrl, savedHost;
    private ValueCallback<Uri[]> filePathCallback;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String url = prefs.getString(KEY_URL, null);
        if (url == null || url.trim().isEmpty()) showSetup();
        else showWeb(url, savedInstanceState);
    }
    private void showSetup() {
        savedUrl = null;
        savedHost = null;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0f172a"));
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);
        root.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("Pulse Med");
        title.setTextColor(Color.WHITE);
        title.setTextSize(32);
        root.addView(title);
        TextView hint = new TextView(this);
        hint.setText("Type the Phone URL shown by start-phone.cmd on your PC, for example http://192.168.1.20:3200");
        hint.setTextColor(Color.parseColor("#94a3b8"));
        hint.setTextSize(16);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintParams.topMargin = pad / 2;
        root.addView(hint, hintParams);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.parseColor("#64748b"));
        input.setHint("http://192.168.1.20:3200");
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        inputParams.topMargin = pad / 2;
        root.addView(input, inputParams);
        Button connect = new Button(this);
        connect.setText("Connect");
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = pad / 2;
        buttonParams.gravity = Gravity.END;
        root.addView(connect, buttonParams);
        connect.setOnClickListener(v -> {
            String url = input.getText().toString().trim();
            if (url.isEmpty()) return;
            if (!url.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*")) url = "http://" + url;
            while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
            prefs.edit().putString(KEY_URL, url).apply();
            savedUrl = url;
            showWeb(url, null);
        });
        WebView old = webView;
        webView = null;
        setContentView(root);
        if (old != null) { old.stopLoading(); old.destroy(); }
    }
    private void showWeb(String url, Bundle savedInstanceState) {
        savedUrl = url;
        savedHost = Uri.parse(url).getHost();
        if (webView == null) {
            webView = new WebView(this);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setSupportZoom(false);
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
            webView.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return handleUrl(view, request.getUrl().toString());
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return handleUrl(view, url);
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) showError(view);
                }
                @Override public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    showError(view);
                }
            });
            webView.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
                    if (MainActivity.this.filePathCallback != null) MainActivity.this.filePathCallback.onReceiveValue(null);
                    MainActivity.this.filePathCallback = callback;
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    try {
                        startActivityForResult(Intent.createChooser(intent, "Choose file"), FILE_CHOOSER_REQUEST);
                    } catch (Exception e) {
                        callback.onReceiveValue(null);
                        MainActivity.this.filePathCallback = null;
                        return false;
                    }
                    return true;
                }
            });
            webView.setDownloadListener((downloadUrl, userAgent, contentDisposition, mimetype, contentLength) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))); } catch (Exception ignored) {}
            });
        }
        setContentView(webView);
        if (savedInstanceState != null) {
            WebBackForwardList restored = webView.restoreState(savedInstanceState);
            if (restored == null) webView.loadUrl(url);
        } else webView.loadUrl(url);
    }
    private boolean handleUrl(WebView view, String url) {
        if (url.startsWith("pulse://retry")) {
            if (savedUrl != null) view.loadUrl(savedUrl);
            return true;
        }
        if (url.startsWith("pulse://change")) {
            prefs.edit().remove(KEY_URL).apply();
            savedUrl = null;
            savedHost = null;
            view.post(this::showSetup);
            return true;
        }
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        if (host != null && savedHost != null && !savedHost.equalsIgnoreCase(host)) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
            return true;
        }
        return false;
    }
    private void showError(WebView view) {
        String html = "<!DOCTYPE html><html><body style=\"margin:0;background:#0f172a;color:#e2e8f0;"
                + "font-family:sans-serif;display:flex;align-items:center;justify-content:center;"
                + "height:100vh;text-align:center;\"><div><h2>Cannot reach your PC. Check Wi-Fi and that "
                + "start-phone.cmd is running.</h2><p><a style=\"color:#38bdf8\" href=\"pulse://retry\">Retry</a>"
                + " &nbsp; <a style=\"color:#38bdf8\" href=\"pulse://change\">Change URL</a></p></div></body></html>";
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }
    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }
}
