package com.imeilens.scanner;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

public final class MainActivity extends Activity {
    private static final String WORK_NAME = "imei-lens-background-scan";
    private WebView webView;
    private String selectedPerson = "person-1";
    private ValueCallback<Uri[]> webFileCallback;
    private File pendingExport;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (webFileCallback != null) webFileCallback.onReceiveValue(null);
                webFileCallback = callback;
                try { startActivityForResult(params.createIntent(), 1002); return true; }
                catch (Exception error) { webFileCallback = null; callback.onReceiveValue(null); return false; }
            }
        });
        webView.addJavascriptInterface(new Bridge(), "AndroidScanner");
        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 1002) {
            if (webFileCallback != null) webFileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            webFileCallback = null;
            return;
        }
        if (requestCode == 1003) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try (InputStream input = new FileInputStream(pendingExport);
                     OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                } catch (Exception ignored) { }
            }
            if (pendingExport != null) pendingExport.delete();
            pendingExport = null;
            return;
        }
        if (requestCode != 1001 || resultCode != RESULT_OK || data == null) return;
        JSONArray queue = selectedPhotos(data);
        if (queue.length() == 0) return;
        if (ScanStore.start(this, queue, selectedPerson)) {
            WorkManager.getInstance(this).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE,
                new OneTimeWorkRequest.Builder(ScanWorker.class).build());
        }
        notifyWeb();
    }

    private JSONArray selectedPhotos(Intent data) {
        ArrayList<Uri> uris = new ArrayList<>();
        ClipData clips = data.getClipData();
        if (clips != null) for (int i = 0; i < clips.getItemCount(); i++) uris.add(clips.getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        JSONArray queue = new JSONArray();
        for (Uri uri : uris) {
            if (queue.length() >= 500) break;
            try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (SecurityException ignored) { continue; }
            JSONObject item = new JSONObject();
            try { item.put("uri", uri.toString()); item.put("name", displayName(uri)); queue.put(item); }
            catch (Exception ignored) { }
        }
        return queue;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "Phone photo.jpg";
    }

    private void notifyWeb() {
        runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new Event('android-scan-updated'))", null));
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private final class Bridge {
        @JavascriptInterface public void choosePhotos(String personId) {
            selectedPerson = personId.length() > 80 ? personId.substring(0, 80) : personId;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("image/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(intent, 1001);
            });
        }

        @JavascriptInterface public String status() {
            try { return ScanStore.read(MainActivity.this).toString(); }
            catch (Exception error) { return "{\"status\":\"error\",\"error\":\"Cannot read saved scan\",\"records\":[]}"; }
        }

        @JavascriptInterface public String image(String id) {
            try {
                File file = ScanStore.image(MainActivity.this, id);
                if (!file.isFile()) return "";
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (FileInputStream input = new FileInputStream(file)) {
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = input.read(chunk)) != -1) bytes.write(chunk, 0, count);
                }
                return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
            } catch (Exception error) { return ""; }
        }

        @JavascriptInterface public void stop() {
            ScanStore.stop(MainActivity.this);
            WorkManager.getInstance(MainActivity.this).cancelUniqueWork(WORK_NAME);
            notifyWeb();
        }

        @JavascriptInterface public void saveFile(String filename, String mimeType, String base64) {
            try {
                File temp = File.createTempFile("imei-export-", ".bin", getCacheDir());
                try (FileOutputStream output = new FileOutputStream(temp)) {
                    output.write(Base64.decode(base64, Base64.DEFAULT));
                }
                runOnUiThread(() -> {
                    if (pendingExport != null) pendingExport.delete();
                    pendingExport = temp;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                    intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[/\\\\]", "_"));
                    startActivityForResult(intent, 1003);
                });
            } catch (Exception ignored) { }
        }
    }
}
