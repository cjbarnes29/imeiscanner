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
        cleanStaleCache();
        if (state == null) handleShare(getIntent());
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
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
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(webView, new android.widget.FrameLayout.LayoutParams(-1, -1));
        root.setBackgroundColor(0xFF0B1220);
        // Android 15 draws apps edge to edge: keep the page clear of the status bar, gesture bar and keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return android.view.WindowInsets.CONSUMED;
            });
        } else root.setFitsSystemWindows(true);
        setContentView(root);
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
        if (requestCode == 1005) {
            boolean chosen = false;
            String label = "";
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri tree = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    label = folderLabel(tree);
                    getSharedPreferences("app-state", MODE_PRIVATE).edit().putString("save-tree", tree.toString()).putString("save-tree-name", label).apply();
                    chosen = true;
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Could not keep the save folder", error); }
            }
            notifySaveFolder(chosen, label);
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
            if (queue.length() >= ScanStore.MAX_PHOTOS) break;
            try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (SecurityException ignored) { continue; }
            JSONObject item = new JSONObject();
            try { item.put("uri", uri.toString()); item.put("name", displayName(uri)); queue.put(item); }
            catch (Exception ignored) { }
        }
        return queue;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    /** Photos shared from WhatsApp, Gallery and other apps: copy them here (the sender's access ends soon), then scan. */
    private void handleShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean single = Intent.ACTION_SEND.equals(action), many = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!single && !many) return;
        String type = intent.getType();
        if (type != null && !type.startsWith("image/") && !"*/*".equals(type)) return;
        ArrayList<Uri> uris = new ArrayList<>();
        if (single) {
            Uri one = androidx.core.content.IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> list = androidx.core.content.IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (list != null) uris.addAll(list);
        }
        ClipData clips = intent.getClipData();
        if (uris.isEmpty() && clips != null) for (int i = 0; i < clips.getItemCount(); i++) if (clips.getItemAt(i).getUri() != null) uris.add(clips.getItemAt(i).getUri());
        setIntent(new Intent(this, MainActivity.class)); // handled: do not run again if the screen is recreated
        if (uris.isEmpty()) return;
        final String person = getSharedPreferences("app-state", MODE_PRIVATE).getString("active-person", selectedPerson);
        new Thread(() -> {
            File folder = new File(ScanStore.root(this), "shared");
            if (!folder.exists() && !folder.mkdirs()) return;
            JSONArray queue = new JSONArray();
            for (Uri uri : uris) {
                if (queue.length() >= ScanStore.MAX_PHOTOS) break;
                File copy = new File(folder, "shared-" + UUID.randomUUID() + ".jpg");
                try (InputStream input = getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(copy)) {
                    if (input == null) continue;
                    byte[] chunk = new byte[16384]; int count;
                    while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                } catch (Exception error) { copy.delete(); continue; }
                try { queue.put(new JSONObject().put("uri", Uri.fromFile(copy).toString()).put("name", displayName(uri))); }
                catch (Exception ignored) { copy.delete(); }
            }
            if (queue.length() == 0) return;
            if (ScanStore.start(this, queue, person)) {
                WorkManager.getInstance(this).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, new OneTimeWorkRequest.Builder(ScanWorker.class).build());
            } else ScanStore.addPending(this, queue, person);
            notifyWeb();
            final int shared = queue.length();
            runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-shared',{detail:{count:" + shared + "}}))", null));
        }).start();
    }

    private String folderLabel(Uri tree) {
        try (Cursor cursor = getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)),
                new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && cursor.getString(0) != null) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "the folder you chose";
    }

    private void notifySaveFolder(boolean chosen, String label) {
        JSONObject detail = new JSONObject();
        try { detail.put("set", chosen); detail.put("name", label); } catch (Exception ignored) { }
        runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-save-folder',{detail:" + detail + "}))", null));
    }

    private void notifySaved(boolean ok, int count, String where, String problem) {
        JSONObject detail = new JSONObject();
        try { detail.put("ok", ok); detail.put("count", count); detail.put("where", where); detail.put("error", problem); } catch (Exception ignored) { }
        runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-saved',{detail:" + detail + "}))", null));
    }

    /** The id of a file or folder with this name inside a folder of the saved tree, or null. */
    private String findChild(Uri tree, String parentId, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        try (Cursor cursor = getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor != null) while (cursor.moveToNext()) if (name.equals(cursor.getString(1))) return cursor.getString(0);
        } catch (Exception ignored) { }
        return null;
    }

    /** Remove the pictures and numbers file an earlier save left in this folder, so a new save replaces them exactly. */
    private void removeOldReport(Uri tree, String parentId) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        java.util.ArrayList<String> old = new java.util.ArrayList<>();
        try (Cursor cursor = getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor != null) while (cursor.moveToNext()) {
                String name = cursor.getString(1);
                if (name != null && (name.equals("numbers.txt") || name.matches("^\\d{3,4}-.+\\.(jpg|jpeg|png|webp)$"))) old.add(cursor.getString(0));
            }
        } catch (Exception ignored) { }
        for (String id : old) {
            try { DocumentsContract.deleteDocument(getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id)); } catch (Exception ignored) { }
        }
    }

    private static String mimeFor(String name) {
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** Copy the staged files into the remembered folder (in a sub-folder), replacing files with the same names. */
    private void commitToSavedFolder(File folder, String subfolder, boolean clean) {
        int copied = 0;
        String where = "", problem = "";
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("app-state", MODE_PRIVATE);
            String saved = prefs.getString("save-tree", "");
            if (saved.isEmpty()) throw new IllegalStateException("No save folder is chosen. Choose one in Settings.");
            Uri tree = Uri.parse(saved);
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            String parentId = rootId;
            String sub = subfolder == null ? "" : subfolder.replaceAll("[/\\\\:*?\"<>|]", "_").trim();
            where = prefs.getString("save-tree-name", "your folder");
            if (!sub.isEmpty()) {
                String existing = findChild(tree, rootId, sub);
                if (existing != null) parentId = existing;
                else {
                    Uri created = DocumentsContract.createDocument(getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, rootId), DocumentsContract.Document.MIME_TYPE_DIR, sub);
                    if (created == null) throw new IllegalStateException("Cannot create the folder " + sub + ".");
                    parentId = DocumentsContract.getDocumentId(created);
                }
                where = where + "/" + sub;
            }
            if (clean) removeOldReport(tree, parentId);
            File[] files = folder.listFiles();
            if (files != null) {
                java.util.Arrays.sort(files);
                for (File file : files) {
                    String existing = findChild(tree, parentId, file.getName());
                    Uri target;
                    if (existing != null) target = DocumentsContract.buildDocumentUriUsingTree(tree, existing);
                    else {
                        target = DocumentsContract.createDocument(getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, parentId), mimeFor(file.getName()), file.getName());
                        if (target == null) throw new IllegalStateException("Cannot create " + file.getName() + ".");
                    }
                    try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new IllegalStateException("Cannot open " + file.getName() + ".");
                        byte[] chunk = new byte[16384]; int count;
                        while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                    }
                    copied++;
                }
            }
        } catch (Exception error) {
            android.util.Log.e("IMEI-Lens", "Saving to the remembered folder failed", error);
            problem = error.getMessage() == null ? "Could not save to the folder." : error.getMessage();
        } finally { deleteFolder(folder); }
        notifySaved(problem.isEmpty(), copied, where, problem);
    }

    private boolean packageInstalled(String name) {
        try { getPackageManager().getPackageInfo(name, 0); return true; }
        catch (Exception error) { return false; }
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

    /** Shared and exported copies are temporary: remove any left over from earlier runs. */
    private void cleanStaleCache() {
        File[] items = getCacheDir().listFiles();
        if (items == null) return;
        long cutoff = System.currentTimeMillis() - 60L * 60L * 1000L;
        for (File item : items) {
            if (item.getName().startsWith("imei-folder-") && item.isDirectory() && item.lastModified() < cutoff) deleteFolder(item);
            else if (item.getName().startsWith("imei-export-") && item.lastModified() < cutoff) item.delete();
        }
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

        /** Scan speed ("fast", "standard", "detailed") and products per photo (0 = Auto) for the background scanner. */
        @JavascriptInterface public void setScanOptions(String speed, int expected) {
            String clean = "fast".equals(speed) || "detailed".equals(speed) ? speed : "standard";
            getSharedPreferences("app-state", MODE_PRIVATE).edit()
                .putString("scan-speed", clean).putInt("scan-expected", Math.max(0, Math.min(ImageScanner.MAX_PRODUCTS, expected))).apply();
        }

        /** The crop queue's progress. While active, an ongoing notification and a wake lock keep the app working when minimized. */
        @JavascriptInterface public void queueStatus(int done, int total, boolean active) {
            if (active) QueueService.show(MainActivity.this, done, total); else QueueService.hide(MainActivity.this);
        }

        /** True once if the notification's Pause button was tapped. */
        @JavascriptInterface public boolean queueStopRequested() {
            boolean value = QueueService.stopRequested;
            QueueService.stopRequested = false;
            return value;
        }

        @JavascriptInterface public String status() {
            try { return ScanStore.json(MainActivity.this); }
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
                int turn = 0;
                if (records != null) for (int index = 0; index < records.length(); index++) {
                    JSONObject row = records.optJSONObject(index);
                    if (row != null && id.equals(row.optString("id"))) {
                        uri = row.optString("sourceUri");
                        filename = row.optString("name");
                        turn = row.optInt("rotation", 0);
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
                if (turn != 0) { Bitmap turned = ImageScanner.rotate(source, turn); source.recycle(); source = turned; }
                try {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    source.compress(Bitmap.CompressFormat.JPEG, 88, bytes);
                    return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
                } finally { source.recycle(); }
            } catch (Exception error) { return ""; }
        }

        /** The web page tells the app which person new scans belong to, so shared photos go to the same person. */
        @JavascriptInterface public void setActivePerson(String personId) {
            if (personId == null || personId.length() > 80) return;
            getSharedPreferences("app-state", MODE_PRIVATE).edit().putString("active-person", personId).apply();
        }

        /** Like status(), but only the records from this index on (at most 200) and without the photo queue. */
        @JavascriptInterface public String statusFrom(int from) {
            try { return ScanStore.jsonFrom(MainActivity.this, from); }
            catch (Exception error) { return "{\"status\":\"error\",\"error\":\"Cannot read saved scan\",\"records\":[],\"recordsFrom\":0,\"recordsTotal\":0}"; }
        }

        /** A long text (for example 1000 IMEI numbers) through the share menu: WhatsApp links are too short for it. */
        @JavascriptInterface public boolean shareText(String title, String text) {
            if (text == null || text.isEmpty()) return false;
            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(send, title == null || title.isEmpty() ? "Send numbers" : title));
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Share text failed", error); }
            });
            return true;
        }

        /** Which ways of sending this phone has: WhatsApp installed, Bluetooth present and switched on. */
        @JavascriptInterface public String sendCapabilities() {
            JSONObject json = new JSONObject();
            try {
                json.put("whatsapp", packageInstalled("com.whatsapp") || packageInstalled("com.whatsapp.w4b"));
                android.bluetooth.BluetoothManager manager = (android.bluetooth.BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
                android.bluetooth.BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
                json.put("bluetooth", adapter != null);
                json.put("bluetoothOn", adapter != null && adapter.isEnabled());
            } catch (Exception ignored) { }
            return json.toString();
        }

        /** Is a save folder remembered, and what is it called. */
        @JavascriptInterface public String saveFolderInfo() {
            JSONObject json = new JSONObject();
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("app-state", MODE_PRIVATE);
                String saved = prefs.getString("save-tree", "");
                boolean held = false;
                if (!saved.isEmpty()) for (android.content.UriPermission permission : getContentResolver().getPersistedUriPermissions())
                    if (permission.getUri().toString().equals(saved) && permission.isWritePermission()) held = true;
                json.put("set", held);
                json.put("name", held ? prefs.getString("save-tree-name", "") : "");
            } catch (Exception ignored) { }
            return json.toString();
        }

        /** Ask once for a folder; the app keeps the permission and the choice. */
        @JavascriptInterface public void chooseSaveFolder() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    startActivityForResult(intent, 1005);
                } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Folder choice failed", error); notifySaveFolder(false, ""); }
            });
        }

        @JavascriptInterface public void forgetSaveFolder() {
            android.content.SharedPreferences prefs = getSharedPreferences("app-state", MODE_PRIVATE);
            String saved = prefs.getString("save-tree", "");
            if (!saved.isEmpty()) {
                try { getContentResolver().releasePersistableUriPermission(Uri.parse(saved), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) { }
            }
            prefs.edit().remove("save-tree").remove("save-tree-name").apply();
            notifySaveFolder(false, "");
        }

        /**
         * Copy the files staged under this token into the remembered folder, in the sub-folder, without asking.
         * With clean = true the earlier numbered pictures and numbers.txt there are replaced. The page is told when it is done.
         */
        @JavascriptInterface public boolean commitStaged(String token, String subfolder, boolean clean) {
            File folder;
            synchronized (MainActivity.this) {
                if (stagingFolder == null || !token.equals(stagingFolderToken)) return false;
                folder = stagingFolder;
                stagingFolder = null; stagingFolderToken = null; stagingFolderName = null;
            }
            new Thread(() -> commitToSavedFolder(folder, subfolder, clean)).start();
            return true;
        }

        @JavascriptInterface public String speedInfo() { return DeviceProfile.describe(MainActivity.this); }

        @JavascriptInterface public boolean setSpeedMode(String mode) { return DeviceProfile.setMode(MainActivity.this, mode); }

        /** Stops any running scan and deletes every saved scan result and cropped photo on this phone. */
        @JavascriptInterface public boolean resetScans() {
            try {
                WorkManager.getInstance(MainActivity.this).cancelUniqueWork(WORK_NAME);
                ScanStore.stop(MainActivity.this);
                ScanStore.clear(MainActivity.this);
                notifyWeb();
                return true;
            } catch (Exception error) { android.util.Log.e("IMEI-Lens", "Reset failed", error); return false; }
        }

        @JavascriptInterface public void stop() {
            ScanStore.stop(MainActivity.this);
            WorkManager.getInstance(MainActivity.this).cancelUniqueWork(WORK_NAME);
            notifyWeb();
        }

        @JavascriptInterface public String beginFile(String filename) {
            synchronized (MainActivity.this) {
                if (pendingExport != null) return "";
                // A new save replaces one that was started and never finished (closed screen, slow phone).
                if (stagingExport != null) { stagingExport.delete(); stagingExport = null; stagingToken = null; }
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
                if (pendingFolder != null) return "";
                // A new save or share replaces one that was started and never finished.
                if (stagingFolder != null) { deleteFolder(stagingFolder); stagingFolder = null; stagingFolderToken = null; stagingFolderName = null; }
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

        /** Opens Android's share menu (Bluetooth, Quick Share, WhatsApp...) with the files staged under this token. */
        @JavascriptInterface public boolean shareFolder(String token, String title) { return shareFolderText(token, title, ""); }

        /** Same as shareFolder, and also sends one text message (for example all IMEI and serial numbers) once. */
        @JavascriptInterface public boolean shareFolderText(String token, String title, String text) { return shareStaged(token, title, text, null); }

        /** Sends straight to the Bluetooth app when the phone has the standard one, otherwise opens the share menu. */
        @JavascriptInterface public boolean shareFolderBluetooth(String token, String title) { return shareStaged(token, title, "", "com.android.bluetooth"); }

        private boolean shareStaged(String token, String title, String text, String targetPackage) {
            File folder;
            synchronized (MainActivity.this) {
                if (stagingFolder == null || !token.equals(stagingFolderToken)) return false;
                folder = stagingFolder;
                stagingFolder = null; stagingFolderToken = null; stagingFolderName = null;
            }
            try {
                File[] files = folder.listFiles();
                if (files == null || files.length == 0) { deleteFolder(folder); return false; }
                java.util.Arrays.sort(files);
                ArrayList<Uri> uris = new ArrayList<>();
                for (File file : files) uris.add(androidx.core.content.FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", file));
                Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
                // Pictures only: say so. WhatsApp and Gallery handle image/* better than */*.
                boolean allImages = true;
                for (File file : files) {
                    String lower = file.getName().toLowerCase(java.util.Locale.ROOT);
                    if (!(lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp"))) allImages = false;
                }
                send.setType(allImages ? "image/*" : "*/*");
                send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                ClipData clip = ClipData.newRawUri("", uris.get(0));
                for (int index = 1; index < uris.size(); index++) clip.addItem(new ClipData.Item(uris.get(index)));
                send.setClipData(clip);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                runOnUiThread(() -> {
                    try {
                        if (targetPackage != null) {
                            Intent direct = new Intent(send);
                            direct.setPackage(targetPackage);
                            if (direct.resolveActivity(getPackageManager()) != null) { startActivity(direct); return; }
                        }
                        startActivity(Intent.createChooser(send, title == null || title.isEmpty() ? "Send phones" : title));
                    }
                    catch (Exception error) { android.util.Log.e("IMEI-Lens", "Share menu failed", error); deleteFolder(folder); }
                });
                return true;
            } catch (Exception error) {
                android.util.Log.e("IMEI-Lens", "Share failed", error);
                deleteFolder(folder);
                return false;
            }
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
