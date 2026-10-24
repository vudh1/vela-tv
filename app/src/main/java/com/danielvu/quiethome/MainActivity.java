package com.danielvu.quiethome;

import android.app.Activity;
import android.media.AudioManager;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import android.widget.Toast;
import android.widget.EditText;
import android.text.InputType;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


/** Light WebView TV launcher. All pages/scripts/images are bundled assets: no network permission. */
public final class MainActivity extends Activity {
    private static final String PREFS = "quiet-home";
    private static final String STOCK = "com.google.android.apps.tv.launcherx";
    private static final int PHOTO_REQUEST = 81;
    private WebView web;
    private SharedPreferences prefs;
    private final LinkedHashMap<String, ResolveInfo> launchables = new LinkedHashMap<>();
    private boolean javascriptReady = false;
    private final HashMap<String, String> iconCache = new HashMap<>();
    // Single background worker serializes package scans and icon rendering.
    // Never block WebView's JavaScript interface thread with icon compression.
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean catalogLoading = false;
    private VelaUpdateController updater;
    private VelaCalendarController calendar;
    private VelaPairingServer pairing;
    private final BroadcastReceiver packagesChanged = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            synchronized (MainActivity.this) { iconCache.clear(); }
            prefs.edit().remove("cached_catalog").remove("cached_catalog_at").apply();
            requestAppsAsync();
        }
    };
    private long lastKeyDown = 0L;
    private AudioManager audioManager;
    // When disabled in Personalize, always defer to the regular TV volume handler.
    private volatile boolean customVolumeEnabled = true;
    private boolean consumedVolumePress = false;
    // Select fires on key-up so a long press cannot accidentally launch the app.
    private long selectDownAt = 0L;
    private boolean selectLongHandled = false;
    private final Handler longSelectHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingLongSelect;


    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        updater = new VelaUpdateController(this, prefs);
        calendar = new VelaCalendarController(this);
        pairing = new VelaPairingServer(this, calendar);
        IntentFilter packageFilter = new IntentFilter();
        packageFilter.addAction(Intent.ACTION_PACKAGE_ADDED);
        packageFilter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        packageFilter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        packageFilter.addAction(Intent.ACTION_PACKAGE_REPLACED);
        packageFilter.addDataScheme("package");
        registerReceiver(packagesChanged, packageFilter);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        // WebView hardware acceleration must remain enabled on TV processors.
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true); // only file:///android_asset/ is loaded
        ws.setAllowFileAccessFromFileURLs(false);
        ws.setAllowUniversalAccessFromFileURLs(false);
        ws.setSupportMultipleWindows(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        web.addJavascriptInterface(new Bridge(), "QuietTV");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("file:///android_asset/")) {
                    javascriptReady = true;
                    web.evaluateJavascript("window.QH && QH.resume()", null);
                    updater.send();
                    updater.maybeCheck();
                }
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if ("https".equals(uri.getScheme()) && "vela-icons.local".equals(uri.getHost())
                    && uri.getPath()!=null && uri.getPath().startsWith("/icon/")) {
                    String id=uri.getLastPathSegment();
                    if (id!=null && id.length()<300) {
                        // Respond to the WebView image request with binary, locally cached artwork.
                        // This runs on a resource thread and never waits for JS callback round trips.
                        String data=getAppIcon(id);
                        String prefix="data:image/webp;base64,";
                        if (data.startsWith(prefix)) {
                            byte[] bytes=Base64.decode(data.substring(prefix.length()),Base64.DEFAULT);
                            return new WebResourceResponse("image/webp",null,new ByteArrayInputStream(bytes));
                        }
                    }
                    String svg="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' rx='18' fill='#233b43'/><rect x='18' y='18' width='44' height='44' rx='10' fill='none' stroke='#e2edea' stroke-width='3'/><path d='M32 32h16v16H32z' fill='none' stroke='#e2edea' stroke-width='3'/></svg>";
                    return new WebResourceResponse("image/svg+xml","UTF-8",new ByteArrayInputStream(svg.getBytes(StandardCharsets.UTF_8)));
                }
                return super.shouldInterceptRequest(view, request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return url == null || !url.startsWith("file:///android_asset/");
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        web.requestFocus();
    }

    @Override public void onResume() {
        super.onResume();
        if (web != null && javascriptReady) {
            // Clock and stale app catalog refresh when Android resumes a throttled WebView.
            web.evaluateJavascript("window.QH && QH.resume()", null);
            updater.maybeCheck();
        }
    }

    @Override protected void onPause() {
        if (pendingLongSelect != null) longSelectHandler.removeCallbacks(pendingLongSelect);
        pendingLongSelect = null;
        selectDownAt = 0L;
        selectLongHandled = false;
        if (web != null && javascriptReady) web.evaluateJavascript("window.QH && QH.pause()", null);
        super.onPause();
    }

    @Override public void onDestroy() {
        javascriptReady = false;
        if (web != null) {
            web.removeJavascriptInterface("QuietTV"); web.destroy(); web = null;
        }
        try { unregisterReceiver(packagesChanged); } catch (Exception ignored) { }
        if (updater != null) updater.shutdown();
        if (pairing != null) pairing.stop();
        if (calendar != null) calendar.shutdown();
        io.shutdownNow();
        super.onDestroy();
    }

    /** A best-effort foreground-only volume handler. HDMI-CEC/fixed-volume devices retain OEM handling.
     *  No FLAG_SHOW_UI: when supported, Vela draws its own small non-interactive indicator.
     *  Never use a global Accessibility listener or system overlay to capture volume keys. */
    private boolean adjustVelaVolume(int key) {
        AudioManager a = audioManager;
        if (a == null || a.isVolumeFixed()) return false;
        try {
            int stream = AudioManager.STREAM_MUSIC;
            int max = a.getStreamMaxVolume(stream);
            if (max <= 0) return false;
            int direction = key == KeyEvent.KEYCODE_VOLUME_UP ? AudioManager.ADJUST_RAISE
                : key == KeyEvent.KEYCODE_VOLUME_DOWN ? AudioManager.ADJUST_LOWER
                : AudioManager.ADJUST_TOGGLE_MUTE;
            a.adjustStreamVolume(stream, direction, 0);
            int current = a.getStreamVolume(stream);
            boolean muted = a.isStreamMute(stream) || current <= 0;
            int percent = Math.max(0, Math.min(100, Math.round(100f * current / max)));
            sendToJs("QH.volumeChanged(" + "{\"percent\":" + percent + ",\"muted\":" + muted + "}" + ")");
            return true;
        } catch (RuntimeException error) {
            android.util.Log.w("VelaVolume", "Sony will handle volume normally", error);
            return false;
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        final int key = e.getKeyCode();
        if (key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN || key == KeyEvent.KEYCODE_VOLUME_MUTE) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                if (customVolumeEnabled && web != null && javascriptReady) {
                    consumedVolumePress = adjustVelaVolume(key);
                    if (consumedVolumePress) return true;
                }
                consumedVolumePress = false;
            } else if (e.getAction() == KeyEvent.ACTION_UP && consumedVolumePress) {
                consumedVolumePress = false;
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
        if (web != null && javascriptReady) {
            int code = e.getKeyCode();
            String key = null;
            if (code == KeyEvent.KEYCODE_DPAD_UP) key="up";
            else if (code == KeyEvent.KEYCODE_DPAD_DOWN) key="down";
            else if (code == KeyEvent.KEYCODE_DPAD_LEFT) key="left";
            else if (code == KeyEvent.KEYCODE_DPAD_RIGHT) key="right";
            else if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) key="select";
            else if (code == KeyEvent.KEYCODE_BACK) key="back";
            if (key != null) {
                if ("select".equals(key)) {
                    if (e.getAction() == KeyEvent.ACTION_DOWN) {
                        if (e.getRepeatCount() == 0 && selectDownAt == 0L) {
                            selectDownAt = android.os.SystemClock.uptimeMillis();
                            selectLongHandled = false;
                            pendingLongSelect = () -> {
                                if (selectDownAt > 0L && !selectLongHandled && web != null && javascriptReady) {
                                    selectLongHandled = true;
                                    web.evaluateJavascript("QH.remote('longselect')", null);
                                }
                            };
                            longSelectHandler.postDelayed(pendingLongSelect, 550L);
                        }
                    } else if (e.getAction() == KeyEvent.ACTION_UP) {
                        if (pendingLongSelect != null) longSelectHandler.removeCallbacks(pendingLongSelect);
                        pendingLongSelect = null;
                        if (!e.isCanceled() && selectDownAt > 0L && !selectLongHandled)
                            web.evaluateJavascript("QH.remote('select')", null);
                        selectDownAt = 0L;
                        selectLongHandled = false;
                    }
                    return true;
                }
                if (e.getAction() == KeyEvent.ACTION_DOWN) {
                    // Support a held D-pad, but coalesce very fast repeats.
                    long now = android.os.SystemClock.uptimeMillis();
                    if (e.getRepeatCount() == 0 || now - lastKeyDown >= 24) {
                        lastKeyDown = now;
                        web.evaluateJavascript("QH.remote(" + JSONObject.quote(key) + ")", null);
                    }
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private synchronized void discoverApps() {
        PackageManager pm = getPackageManager();
        LinkedHashMap<String, ResolveInfo> found = new LinkedHashMap<>();
        for (String category : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent search = new Intent(Intent.ACTION_MAIN).addCategory(category);
            for (ResolveInfo r : pm.queryIntentActivities(search, 0)) {
                if (r.activityInfo == null || !r.activityInfo.enabled || !r.activityInfo.applicationInfo.enabled) continue;
                if (getPackageName().equals(r.activityInfo.packageName)) continue;
                if (!found.containsKey(r.activityInfo.packageName)) found.put(r.activityInfo.packageName, r);
            }
        }
        List<ResolveInfo> sorted = new ArrayList<>(found.values());
        Collections.sort(sorted, new Comparator<ResolveInfo>() {
            @Override public int compare(ResolveInfo a, ResolveInfo b) {
                return String.CASE_INSENSITIVE_ORDER.compare(
                    a.loadLabel(pm).toString(), b.loadLabel(pm).toString());
            }
        });
        launchables.clear();
        for (ResolveInfo r : sorted) {
            ComponentName c = new ComponentName(r.activityInfo.packageName, r.activityInfo.name);
            launchables.put(c.flattenToString(), r);
        }
    }

    /** Icons are requested only for tiles that are actually rendered. Avoid putting
     *  hundreds of Base64 images into the initial app metadata response. */
    private synchronized String getAppIcon(String id) {
        if (iconCache.containsKey(id)) return iconCache.get(id);
        ResolveInfo r = launchables.get(id);
        ComponentName component = ComponentName.unflattenFromString(id);
        if (component == null || getPackageName().equals(component.getPackageName())) return "";
        String pkg = component.getPackageName();
        File dir = new File(getCacheDir(), "app-icons");
        if (!dir.exists()) dir.mkdirs();
        long updateTime = 0;
        try { updateTime = getPackageManager().getPackageInfo(pkg, 0).lastUpdateTime; }
        catch (Exception ignored) { return ""; }
        File cached = new File(dir, Integer.toHexString(id.hashCode()) + "-" + updateTime + ".webp");
        String encoded = "";
        if (cached.isFile() && cached.length() > 0 && cached.length() < 80000) {
            try (FileInputStream in = new FileInputStream(cached)) {
                byte[] bytes = new byte[(int) cached.length()];
                int off=0,n;while(off<bytes.length && (n=in.read(bytes,off,bytes.length-off))>0)off+=n;
                if(off==bytes.length)encoded="data:image/webp;base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP);
            } catch (Exception ignored) { }
        }
        if (encoded.isEmpty()) encoded = iconData(r, pkg, cached);
        if (iconCache.size() >= 48) iconCache.clear();
        iconCache.put(id, encoded);
        return encoded;
    }

    /** Persist scaled WebP icons across launches to avoid repeated draw/compression work. */
    private String iconData(ResolveInfo r, String pkg, File cached) {
        PackageManager pm = getPackageManager();
        Drawable drawable = null;
        try { drawable = pm.getApplicationIcon(pkg); } catch (Exception ignored) { }
        if (drawable == null && r != null) try { drawable = r.loadIcon(pm); } catch (Exception ignored) { }
        if (drawable == null) return "";
        try {
            final int size = 80;
            Bitmap bitmap = Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0,0,size,size);drawable.draw(canvas);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.WEBP, 78, output);
            bitmap.recycle();
            byte[] bytes=output.toByteArray();
            if (bytes.length < 80000) try (FileOutputStream out = new FileOutputStream(cached)) { out.write(bytes); }
            return "data:image/webp;base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP);
        } catch (Exception e) {
            android.util.Log.w("VelaApps", "Failed icon for " + pkg, e);return "";
        }
    }

    private synchronized String appsJson() {
        discoverApps();
        JSONArray rows = new JSONArray();
        for (Map.Entry<String, ResolveInfo> entry : launchables.entrySet()) {
            ResolveInfo r = entry.getValue();
            JSONObject j = new JSONObject();
            try {
                j.put("id", entry.getKey());
                j.put("package", r.activityInfo.packageName);
                j.put("name", r.loadLabel(getPackageManager()).toString());
                rows.put(j);
            } catch (Exception ignored) { }
        }
        return rows.toString();
    }

    private void openApp(String id) {
        // Never wait for app catalog discovery to launch a known component.
        ComponentName component = ComponentName.unflattenFromString(id);
        if (component == null || getPackageName().equals(component.getPackageName())) { toast("Invalid app shortcut."); return; }
        try {
            String pkg = component.getPackageName();
            PackageManager pm = getPackageManager();
            Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (intent == null) intent = pm.getLaunchIntentForPackage(pkg);
            if (intent == null || intent.resolveActivity(pm) == null) {
                intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(component);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException err) {
            toast("Unable to open app. Refresh All apps or check installation.");
        }
    }

    private void toast(String msg) { Toast.makeText(this, msg, Toast.LENGTH_LONG).show(); }

    private void openSonyHome() {
        // Do not disable stock packages; pause the optional accessibility redirect first.
        prefs.edit().putBoolean("redirect_home", false).apply();
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            .setComponent(new ComponentName(STOCK, "com.google.android.apps.tv.launcherx.home.HomeActivity"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try { startActivity(i); }
        catch (ActivityNotFoundException | SecurityException e) {
            new AlertDialog.Builder(this).setTitle("Sony Home unavailable")
                .setMessage("The TV may be blocking the stock launcher shortcut. You can use the TV's Home settings or the Mac restore script; no Sony apps were disabled.")
                .setPositiveButton("Settings", (d, n) -> openHomeSettings())
                .setNegativeButton("Cancel", null).show();
        }
    }

    private void openHomeSettings() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager roles = (RoleManager) getSystemService(Context.ROLE_SERVICE);
            if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_HOME)) {
                try { startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_HOME), 401); return; }
                catch (Exception ignored) { }
            }
        }
        try { startActivity(new Intent(Settings.ACTION_HOME_SETTINGS)); }
        catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    }

    private void choosePhoto() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        try { startActivityForResult(i, PHOTO_REQUEST); }
        catch (ActivityNotFoundException e) {
            try { startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT).setType("image/*"), PHOTO_REQUEST); }
            catch (Exception other) { toast("Install a file picker to select your own photo."); }
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PHOTO_REQUEST || result != RESULT_OK || data == null || data.getData() == null) return;
        // Decode downsampled, never retain the source photo's original high resolution in memory.
        try (InputStream in = getContentResolver().openInputStream(data.getData())) {
            android.graphics.BitmapFactory.Options probe = new android.graphics.BitmapFactory.Options();
            probe.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeStream(in, null, probe);
            if (probe.outWidth <= 0 || probe.outHeight <= 0) throw new IllegalStateException("Invalid image dimensions");
            int sample = 1;
            while (probe.outWidth / sample > 1920 || probe.outHeight / sample > 1080) sample *= 2;
            android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
            opts.inSampleSize = sample;
            try (InputStream in2 = getContentResolver().openInputStream(data.getData())) {
                Bitmap bitmap = android.graphics.BitmapFactory.decodeStream(in2, null, opts);
                if (bitmap == null) throw new IllegalStateException("Not an image");
                File dest = new File(getFilesDir(), "custom-wallpaper.jpg");
                try (FileOutputStream out = new FileOutputStream(dest)) { bitmap.compress(Bitmap.CompressFormat.JPEG, 77, out); }
                bitmap.recycle();
                prefs.edit().putBoolean("custom_wallpaper", true).apply();
                if (web != null) web.evaluateJavascript("window.QH && QH.refreshWallpaper()", null);
            }
        } catch (Exception e) { toast("Could not open the selected photo."); }
    }

    private String customWallpaper() {
        if (!prefs.getBoolean("custom_wallpaper", false)) return "";
        File f = new File(getFilesDir(), "custom-wallpaper.jpg");
        if (!f.exists() || f.length() > 4_000_000) return "";
        try (InputStream in = new java.io.FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n=in.read(buf))>0) out.write(buf,0,n);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
        } catch (Exception e) { return ""; }
    }

    private void sendToJs(String expression) {
        runOnUiThread(() -> {
            if (javascriptReady && web != null) web.evaluateJavascript("window.QH && " + expression, null);
        });
    }

    private void requestAppsAsync() {
        synchronized (this) {
            if (catalogLoading) return;
            catalogLoading = true;
        }
        io.execute(() -> {
            try {
                String catalog = appsJson();
                if (!catalog.equals(prefs.getString("cached_catalog", ""))) {
                    prefs.edit().putString("cached_catalog", catalog).putLong("cached_catalog_at", System.currentTimeMillis()).apply();
                    sendToJs("QH.receiveApps(" + JSONObject.quote(catalog) + ")");
                } else {
                    prefs.edit().putLong("cached_catalog_at", System.currentTimeMillis()).apply();
                    sendToJs("QH.catalogRefreshed && QH.catalogRefreshed()");
                }
            } catch (Exception error) {
                android.util.Log.w("VelaApps", "Catalog query failed", error);
            } finally {
                synchronized (MainActivity.this) { catalogLoading = false; }
            }
        });
    }

    private void requestIconAsync(String id) {
        if (id == null || id.length() > 300) return;
        io.execute(() -> {
            String data = getAppIcon(id);
            sendToJs("QH.iconReady(" + JSONObject.quote(id) + "," + JSONObject.quote(data) + ")");
        });
    }

    private void requestWallpaperAsync() {
        io.execute(() -> sendToJs("QH.wallpaperReady(" + JSONObject.quote(customWallpaper()) + ")"));
    }

    private void screensaverSettings() {
        Intent intent = new Intent("android.settings.DREAM_SETTINGS");
        try { startActivity(intent); }
        catch (Exception e) {
            toast("Screensaver selection is unavailable here. Check Sony Settings → System → Ambient mode.");
        }
    }

    public void deliverCalendar(String json) {
        sendToJs("QH.receiveCalendar(" + JSONObject.quote(json) + ")");
    }

    public void showCalendarError(String message) {
        runOnUiThread(() -> toast(message));
    }

    public void deliverUpdateStatus(String json) {
        sendToJs("QH.updateStatusReady(" + JSONObject.quote(json) + ")");
    }

    public final class Bridge {
        @JavascriptInterface public void loadCalendar(String profile, boolean force) { calendar.load(profile,force); }
        @JavascriptInterface public void pairCalendar(String profile) {
            // Called from Android WebView bridge thread, never block the UI.
            try { String link=pairing.start(profile);sendToJs("QH.pairingReady("+JSONObject.quote(link)+")"); }
            catch(Exception e){showCalendarError("Connect the TV and phone to the same private home network");sendToJs("QH.pairingReady('')");}
        }
        @JavascriptInterface public void cancelCalendarPair(){if(pairing!=null)pairing.stop();}
        @JavascriptInterface public void editCalendar(String profile) { calendar.edit(profile); }
        @JavascriptInterface public void removeCalendar(String profile) { calendar.remove(profile); }
        @JavascriptInterface public void editProfile(String mode, String id, String currentName) {
            runOnUiThread(() -> {
                if (!"add".equals(mode) && !"rename".equals(mode)) return;
                EditText input = new EditText(MainActivity.this);
                input.setSingleLine(true);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
                input.setText(currentName == null ? "" : currentName);
                input.setSelectAllOnFocus(true);
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("add".equals(mode) ? "New Vela profile" : "Rename profile")
                    .setView(input)
                    .setNegativeButton("Cancel", (d, which) -> {})
                    .setPositiveButton("Save", (d, which) -> {
                        String value = input.getText().toString().trim();
                        if (value.isEmpty()) { Toast.makeText(MainActivity.this, "Enter a name", Toast.LENGTH_SHORT).show(); return; }
                        if (value.length() > 24) value = value.substring(0,24);
                        if (web != null) web.evaluateJavascript("window.QH&&QH.profileNameReady("+
                            JSONObject.quote(mode)+","+JSONObject.quote(id)+","+JSONObject.quote(value)+")", null);
                    }).show();
            });
        }
        @JavascriptInterface public void confirmProfileDelete(String id, String name) {
            runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                .setTitle("Delete " + name + "?")
                .setMessage("Only this profile's Vela layout and preferences will be removed. Your TV apps are unaffected.")
                .setNegativeButton("Cancel", (d, which) -> {})
                .setPositiveButton("Delete", (d, which) -> {
                    if (web != null) web.evaluateJavascript("window.QH&&QH.profileDeleteConfirmed("+JSONObject.quote(id)+")", null);
                }).show());
        }
        @JavascriptInterface public String getCachedApps() { return prefs.getString("cached_catalog", ""); }
        @JavascriptInterface public long getCachedCatalogAt() { return prefs.getLong("cached_catalog_at", 0L); }
        @JavascriptInterface public void checkUpdates() { updater.check(); }
        @JavascriptInterface public void installUpdate() { updater.install(); }
        @JavascriptInterface public void updateStatus() { updater.send(); }
        @JavascriptInterface public void setAutoUpdates(boolean enabled) { updater.setAutoEnabled(enabled); }
        @JavascriptInterface public void setCustomVolumeEnabled(boolean enabled) {
            customVolumeEnabled = enabled;
        }
        @JavascriptInterface public void requestApps() { requestAppsAsync(); }
        @JavascriptInterface public void requestAppIcon(String id) { requestIconAsync(id); }
        @JavascriptInterface public void requestWallpaper() { requestWallpaperAsync(); }
        private boolean isAllowedUiSetting(String key) {
            return "favorites".equals(key) || "layout".equals(key) || "theme".equals(key) ||
                   "scenery".equals(key) || "volume_ui".equals(key) || "volume_percent".equals(key) ||
                   "volume_position".equals(key) || "volume_delay".equals(key) || "profile_data_v2".equals(key) || "active_profile_v2".equals(key);
        }
        @JavascriptInterface public String getSetting(String key) {
            if (!isAllowedUiSetting(key)) return "";
            return prefs.getString("ui_"+key, "");
        }
        @JavascriptInterface public void setSetting(String key, String value) {
            if (!isAllowedUiSetting(key)) return;
            if (value == null || value.length()>32768) return;
            prefs.edit().putString("ui_"+key,value).apply();
        }
        @JavascriptInterface public boolean redirectEnabled() { return prefs.getBoolean("redirect_home", false); }
        @JavascriptInterface public void setRedirect(boolean active) { prefs.edit().putBoolean("redirect_home", active).apply(); }
        @JavascriptInterface public String getWallpaper() { return customWallpaper(); }
        @JavascriptInterface public void launchApp(String id) { runOnUiThread(() -> openApp(id)); }
        @JavascriptInterface public boolean is24HourClock() { return DateFormat.is24HourFormat(MainActivity.this); }
        @JavascriptInterface public void openAppInfo(String id) {
            runOnUiThread(() -> {
                ComponentName target = ComponentName.unflattenFromString(id);
                if (target == null || getPackageName().equals(target.getPackageName())) return;
                try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + target.getPackageName()))); }
                catch (ActivityNotFoundException | SecurityException ex) { toast("App settings unavailable."); }
            });
        }
        @JavascriptInterface public void sonyHome() { runOnUiThread(() -> openSonyHome()); }
        /** Official Nanit web account portal; external browser owns its sign-in session.
         *  Never intercept credentials in Vela's JavaScript interface. */
        @JavascriptInterface public void openNanitWeb() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://my.nanit.com"));
                    intent.addCategory(Intent.CATEGORY_BROWSABLE);
                    startActivity(intent);
                } catch (ActivityNotFoundException | SecurityException e) {
                    toast("Install a TV web browser to use Nanit's web viewer, or view Nanit on your phone.");
                }
            });
        }

        @JavascriptInterface public void systemSettings() { runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_SETTINGS))); }
        @JavascriptInterface public void screensaverSettings() { runOnUiThread(() -> MainActivity.this.screensaverSettings()); }
        @JavascriptInterface public void accessibilitySettings() { runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))); }
        @JavascriptInterface public void homeSettings() { runOnUiThread(() -> openHomeSettings()); }
        @JavascriptInterface public void chooseWallpaper() { runOnUiThread(() -> choosePhoto()); }
        @JavascriptInterface public void resetWallpaper() {
            prefs.edit().putBoolean("custom_wallpaper", false).apply();
            new File(getFilesDir(), "custom-wallpaper.jpg").delete();
        }
    }
}
