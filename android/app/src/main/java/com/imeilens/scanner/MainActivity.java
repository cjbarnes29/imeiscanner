package com.imeilens.scanner;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
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
import java.util.UUID;

public final class MainActivity extends Activity {
    private static final String WORK_NAME = "imei-lens-background-scan";
    private WebView webView;
    private android.webkit.PermissionRequest cameraRequest;

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1010 && cameraRequest != null) {
            if (results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED)
                cameraRequest.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else cameraRequest.deny();
            cameraRequest = null;
        }
    }
    private String selectedPerson = "person-1";
    private ValueCallback<Uri[]> webFileCallback;
    private File pendingExport;
    private String pendingExportName;
    private File stagingExport;
    // Folder export: files staged in cache, then copied into a new folder the user picks.
    private File stagingFolder;
    private String stagingFolderToken;
    private String stagingFolderName;
    private File pendingFolder;
    private String pendingFolderName;
    private String stagingToken;

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
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!"https".equals(request.getOrigin().getScheme()) || !"appassets.androidplatform.net".equals(request.getOrigin().getHost())) { request.deny(); return; }
                    if (!java.util.Arrays.asList(request.getResources()).contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED)
                        request.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    else { if (cameraRequest != null) cameraRequest.deny(); cameraRequest = request; requestPermissions(new String[]{Manifest.permission.CAMERA}, 1010); }
                });
            }
            @Override public void onPermissionRequestCanceled(android.webkit.PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
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
        if (requestCode == 1004) {
            boolean saved = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingFolder != null) {
                try {
                    Uri tree = data.getData();
                    Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    Uri folder = DocumentsContract.createDocument(getContentResolver(), parent, DocumentsContract.Document.MIME_TYPE_DIR, pendingFolderName);
                    if (folder == null) throw new IllegalStateException("Cannot create folder");
                    File[] files = pendingFolder.listFiles();
                    if (files != null) for (File file : files) {
                        String name = file.getName();
                        String mime = name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : name.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
                        Uri target = DocumentsContract.createDocument(getContentResolver(), folder, mime, name);
                        if (target == null) throw new IllegalStateException("Cannot create " + name);
                        try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(target)) {
                            if (output == null) throw new IllegalStateException("Cannot open " + name);
                            byte[] chunk = new byte[8192]; int count;
                            while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                        }
                    }
                    saved = true;
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Folder export failed", error); }
            }
            String name = pendingFolderName;
            deleteFolder(pendingFolder);
            pendingFolder = null;
            pendingFolderName = null;
            reportExport(saved ? "saved" : resultCode == RESULT_CANCELED ? "cancelled" : "failed", name);
            return;
        }
        if (requestCode == 1003) {
            boolean saved = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try (InputStream input = new FileInputStream(pendingExport);
                     OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output == null) throw new IllegalStateException("Cannot open destination");
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                    output.flush();
                    saved = true;
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Export failed", error); }
            }
            String name = pendingExportName;
            if (pendingExport != null) pendingExport.delete();
            pendingExport = null;
            pendingExportName = null;
            reportExport(saved ? "saved" : resultCode == RESULT_CANCELED ? "cancelled" : "failed", name);
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

    private static void deleteFolder(File folder) {
        if (folder == null) return;
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) file.delete();
        folder.delete();
    }

    private void reportExport(String status, String filename) {
        runOnUiThread(() -> {
            JSONObject detail = new JSONObject();
            try { detail.put("status", status); detail.put("filename", filename == null ? "file" : filename); }
            catch (Exception ignored) { }
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-export-result',{detail:" + detail + "}))", null);
        });
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

        @JavascriptInterface public String sourceImage(String id) {
            try {
                JSONObject job = ScanStore.read(MainActivity.this);
                JSONArray records = job.optJSONArray("records");
                JSONArray queue = job.optJSONArray("queue");
                String uri = "", filename = "";
                if (records != null) for (int index = 0; index < records.length(); index++) {
                    JSONObject row = records.optJSONObject(index);
                    if (row != null && id.equals(row.optString("id"))) {
                        uri = row.optString("sourceUri");
                        filename = row.optString("name");
                        break;
                    }
                }
                if (uri.isEmpty() && queue != null) for (int index = 0; index < queue.length(); index++) {
                    JSONObject photo = queue.optJSONObject(index);
                    if (photo != null && filename.equals(photo.optString("name"))) {
                        uri = photo.optString("uri");
                        break;
                    }
                }
                if (uri.isEmpty()) return "";
                Bitmap source = ImageScanner.decode(MainActivity.this, Uri.parse(uri));
                try {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    source.compress(Bitmap.CompressFormat.JPEG, 88, bytes);
                    return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
                } finally { source.recycle(); }
            } catch (Exception error) { return ""; }
        }

        @JavascriptInterface public void stop() {
            ScanStore.stop(MainActivity.this);
            WorkManager.getInstance(MainActivity.this).cancelUniqueWork(WORK_NAME);
            notifyWeb();
        }

        @JavascriptInterface public String beginFile(String filename) {
            synchronized (MainActivity.this) {
                if (stagingExport != null || pendingExport != null) return "";
                try {
                    stagingExport = File.createTempFile("imei-export-", ".bin", getCacheDir());
                    stagingToken = UUID.randomUUID().toString();
                    return stagingToken;
                } catch (Exception error) { return ""; }
            }
        }

        @JavascriptInterface public boolean appendFile(String token, String base64) {
            synchronized (MainActivity.this) {
                if (stagingExport == null || !token.equals(stagingToken)) return false;
                try (FileOutputStream output = new FileOutputStream(stagingExport, true)) {
                    output.write(Base64.decode(base64, Base64.DEFAULT));
                    return true;
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Export chunk failed", error); return false; }
            }
        }

        @JavascriptInterface public boolean finishFile(String token, String filename, String mimeType) {
            synchronized (MainActivity.this) {
                if (stagingExport == null || !token.equals(stagingToken) || pendingExport != null) return false;
                pendingExport = stagingExport;
                pendingExportName = filename;
                stagingExport = null;
                stagingToken = null;
            }
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                    intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[/\\\\]", "_"));
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    startActivityForResult(intent, 1003);
                } catch (Exception error) {
                    android.util.Log.e("IMEI-Lens", "Save picker failed", error);
                    if (pendingExport != null) pendingExport.delete();
                    pendingExport = null;
                    pendingExportName = null;
                    reportExport("failed", filename);
                }
            });
            return true;
        }

        @JavascriptInterface public String beginFolder(String folderName) {
            synchronized (MainActivity.this) {
                if (stagingFolder != null || pendingFolder != null) return "";
                File folder = new File(getCacheDir(), "imei-folder-" + UUID.randomUUID());
                if (!folder.mkdirs()) return "";
                stagingFolder = folder;
                stagingFolderName = folderName.replaceAll("[/\\\\:*?\"<>|]", "_");
                stagingFolderToken = UUID.randomUUID().toString();
                return stagingFolderToken;
            }
        }

        @JavascriptInterface public boolean appendFolderFile(String token, String filename, String base64) {
            synchronized (MainActivity.this) {
                if (stagingFolder == null || !token.equals(stagingFolderToken)) return false;
                String safe = filename.replaceAll("[/\\\\:*?\"<>|]", "_");
                if (safe.isEmpty() || safe.startsWith(".")) return false;
                try (FileOutputStream output = new FileOutputStream(new File(stagingFolder, safe), true)) {
                    output.write(Base64.decode(base64, Base64.DEFAULT));
                    return true;
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Folder chunk failed", error); return false; }
            }
        }

        @JavascriptInterface public boolean finishFolder(String token) {
            synchronized (MainActivity.this) {
                if (stagingFolder == null || !token.equals(stagingFolderToken) || pendingFolder != null) return false;
                pendingFolder = stagingFolder;
                pendingFolderName = stagingFolderName;
                stagingFolder = null;
                stagingFolderToken = null;
                stagingFolderName = null;
            }
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    startActivityForResult(intent, 1004);
                } catch (Exception error) {
                    android.util.Log.e("IMEI-Lens", "Folder picker failed", error);
                    String name = pendingFolderName;
                    deleteFolder(pendingFolder);
                    pendingFolder = null;
                    pendingFolderName = null;
                    reportExport("failed", name);
                }
            });
            return true;
        }

        @JavascriptInterface public void abortFolder(String token) {
            synchronized (MainActivity.this) {
                if (stagingFolder != null && token.equals(stagingFolderToken)) {
                    deleteFolder(stagingFolder);
                    stagingFolder = null;
                    stagingFolderToken = null;
                    stagingFolderName = null;
                }
            }
        }

        @JavascriptInterface public void abortFile(String token) {
            synchronized (MainActivity.this) {
                if (stagingExport != null && token.equals(stagingToken)) {
                    stagingExport.delete();
                    stagingExport = null;
                    stagingToken = null;
                }
            }
        }
    }
}
