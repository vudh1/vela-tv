package com.danielvu.quiethome;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;
import android.widget.Toast;
import android.app.Activity;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Public GitHub Releases updater: daily metadata checks, explicit download & installer prompt.
 * Does not use root, accessibility services, or background APK installation.
 * A matching signing certificate is still REQUIRED by Android for upgrades.
 */
final class VelaUpdateController {
    static final String REPO = "vudh1/vela-tv";
    private static final String RELEASE_ENDPOINT = "https://api.github.com/repos/" + REPO + "/releases/latest";
    private static final String RELEASE_PREFIX = "https://github.com/" + REPO + "/releases/download/";
    private static final String APK_ASSET = "Vela-release.apk";
    private static final long MAX_APK_BYTES = 60L * 1024L * 1024L;
    private static final long CHECK_INTERVAL_MS = 24L * 60L * 60L * 1000L;
    private final MainActivity activity;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;
    private volatile boolean available = false;
    private volatile boolean downloaded = false;
    private volatile String status = "Not checked";
    private volatile String latestVersion = "";
    private volatile String url = "";
    private volatile String sha = "";
    private volatile long latestCode = 0L;
    private volatile long size = 0L;

    VelaUpdateController(MainActivity activity, SharedPreferences prefs) {
        this.activity = activity;
        this.prefs = prefs;
    }
    boolean autoEnabled() { return prefs.getBoolean("update_auto_check", true); }
    boolean autoDownloadEnabled() { return prefs.getBoolean("update_auto_download", true); }
    void setAutoEnabled(boolean value) {
        prefs.edit().putBoolean("update_auto_check", value).apply();
        send();
        if (value) maybeCheck();
    }
    void setAutoDownloadEnabled(boolean value) {
        prefs.edit().putBoolean("update_auto_download", value).apply();
        send();
        if (value && available && !downloaded) prefetch();
    }
    long installedCode() {
        try {
            PackageInfo p = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception ignored) { return 0; }
    }
    String installedVersion() {
        try { return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "unknown"; }
    }
    void send() {
        try {
            JSONObject j = new JSONObject();
            j.put("current", installedVersion());
            j.put("currentCode", installedCode());
            j.put("latest", latestVersion);
            j.put("available", available);
            j.put("checking", busy);
            j.put("auto", autoEnabled());
            j.put("autoDownload", autoDownloadEnabled());
            j.put("downloaded", downloaded);
            j.put("status", status);
            activity.deliverUpdateStatus(j.toString());
        } catch (Exception ignored) { }
    }
    void maybeCheck() {
        if (!autoEnabled() || busy) return;
        if (System.currentTimeMillis() - prefs.getLong("last_update_check", 0L) >= CHECK_INTERVAL_MS) check();
    }
    void check() {
        if (busy) { send(); return; }
        busy = true;
        status = "Checking GitHub releases…";
        send();
        worker.execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(RELEASE_ENDPOINT).openConnection();
                connection.setRequestProperty("User-Agent", "Vela-Android-TV-Updater");
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(7000);
                int response = connection.getResponseCode();
                if (response == 404) throw new IllegalStateException("Release feed unavailable. Private GitHub repositories cannot update the TV anonymously; publish a public distribution feed first.");
                if (response != 200) throw new IllegalStateException("GitHub returned HTTP " + response);
                byte[] result;
                try (InputStream in = connection.getInputStream()) { result = readBounded(in, 1_000_000); }
                connection.disconnect();
                JSONObject release = new JSONObject(new String(result, "UTF-8"));
                String tag = release.optString("tag_name", "");
                if (!tag.matches("v[0-9]{1,10}")) throw new IllegalStateException("Unexpected release version tag");
                long code = Long.parseLong(tag.substring(1));
                JSONArray assets = release.getJSONArray("assets");
                String assetUrl = "", digest = "", checksumUrl = "";
                long length = 0;
                for (int i = 0; i < assets.length(); ++i) {
                    JSONObject asset = assets.getJSONObject(i);
                    String assetName = asset.optString("name", "");
                    if ((APK_ASSET + ".sha256").equals(assetName)) {
                        checksumUrl = asset.optString("browser_download_url", "");
                    } else if (APK_ASSET.equals(assetName)) {
                        assetUrl = asset.optString("browser_download_url", "");
                        digest = asset.optString("digest", "");
                        length = asset.optLong("size", 0L);
                    }
                }
                if (!assetUrl.equals(RELEASE_PREFIX + tag + "/" + APK_ASSET))
                    throw new IllegalStateException("Release APK link is missing or unexpected");
                if (!digest.matches("sha256:[a-fA-F0-9]{64}")) {
                    // Some GitHub release assets may not include a populated digest field.
                    String expectedChecksumUrl = RELEASE_PREFIX + tag + "/" + APK_ASSET + ".sha256";
                    if (!expectedChecksumUrl.equals(checksumUrl))
                        throw new IllegalStateException("Release APK has no SHA-256 checksum");
                    digest = "sha256:" + loadPublishedChecksum(checksumUrl);
                }
                if (length < 1024 || length > MAX_APK_BYTES)
                    throw new IllegalStateException("Invalid release APK size");
                latestCode = code;
                latestVersion = release.optString("name", tag);
                url = assetUrl;
                sha = digest.substring(7).toLowerCase(Locale.US);
                size = length;
                available = code > installedCode();
                downloaded = available && cachedValid(sha, size);
                prefs.edit().putLong("last_update_check", System.currentTimeMillis()).apply();
                if (!available) {
                    status = "You're up to date";
                } else if (downloaded) {
                    status = "Update downloaded and verified · select Install downloaded update";
                } else if (autoDownloadEnabled()) {
                    status = "New release found · downloading in the background…";
                    send();
                    try {
                        cacheApk(url, sha, size);
                        downloaded = true;
                        status = "Update downloaded and verified · ready for your approval";
                    } catch (Exception downloadError) {
                        Log.w("VelaUpdate", "Automatic APK download failed", downloadError);
                        status = "Automatic download failed: " + downloadError.getMessage()
                            + ". Select Download & install to retry.";
                    }
                } else {
                    status = "New update available · select Download & install";
                }
            } catch (Exception error) {
                Log.w("VelaUpdate", "Update check failed", error);
                status = "Update check failed: " + error.getMessage();
                // Keep a previously known update available if a network check fails.
            } finally { busy = false; send(); }
        });
    }
    /** Background-only download triggered by an opted-in setting; never starts installer. */
    private void prefetch() {
        if (busy || !available || downloaded || url.isEmpty() || sha.isEmpty()) return;
        busy = true;
        status = "Downloading update in the background…";
        send();
        final String address = url, digest = sha;
        final long length = size;
        worker.execute(() -> {
            try {
                cacheApk(address, digest, length);
                downloaded = true;
                status = "Update downloaded and verified · ready for your approval";
            } catch (Exception error) {
                Log.w("VelaUpdate", "Background APK download failed", error);
                status = "Automatic download failed: " + error.getMessage();
            } finally {
                busy = false;
                send();
            }
        });
    }

    private File cachedApk() {
        return new File(new File(activity.getCacheDir(), "updates"), "vela-update.apk");
    }

    private boolean cachedValid(String digest, long expectedSize) {
        File apk = cachedApk();
        if (!apk.isFile() || apk.length() != expectedSize) return false;
        try { return sha256(apk).equals(digest); }
        catch (Exception ignored) { return false; }
    }

    /** Cache a checksum-verified APK. Download runs on the update worker, never UI. */
    private File cacheApk(String address, String digest, long expectedSize) throws Exception {
        File dir = new File(activity.getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create update storage");
        File apk = cachedApk();
        if (cachedValid(digest, expectedSize)) return apk;
        StatFs fs = new StatFs(dir.getAbsolutePath());
        long required = expectedSize * 2 + 64L * 1024L * 1024L;
        if (fs.getAvailableBytes() < required)
            throw new IllegalStateException("Not enough TV storage. Free space in Sony Settings and retry.");
        File temp = new File(dir, "vela-update.part");
        if (temp.exists()) temp.delete();
        try {
            download(address, expectedSize, temp);
            if (!sha256(temp).equals(digest))
                throw new SecurityException("APK checksum does not match GitHub release");
            if (apk.exists() && !apk.delete()) throw new IllegalStateException("Could not replace cached update");
            if (!temp.renameTo(apk)) throw new IllegalStateException("Could not finalize download");
            return apk;
        } finally {
            if (temp.exists()) temp.delete();
        }
    }

    /** Deliberate TV interaction is required before Android installer is launched. */
    void install() {
        if (busy || !available || url.isEmpty() || sha.isEmpty()) {
            status = "Check for an available update first"; send(); return;
        }
        busy = true;
        status = downloaded ? "Opening Android installer…" : "Preparing update…";
        send();
        final String address = url, digest = sha;
        final long length = size;
        worker.execute(() -> {
            try {
                File apk = cacheApk(address, digest, length);
                downloaded = true;
                status = "Ready for Android installation approval";
                send();
                activity.runOnUiThread(() -> promptInstaller(apk));
            } catch (Exception e) {
                Log.w("VelaUpdate", "Update download failed", e);
                status = "Download failed: " + e.getMessage();
                send();
            } finally { busy = false; send(); }
        });
    }
    private void promptInstaller(File apk) {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                status = "Allow Vela to install unknown apps, then select Download & install again";
                send();
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(settings);
                return;
            }
            Uri fileUri = Uri.parse("content://" + activity.getPackageName() + ".updates/updates/vela-update.apk");
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setDataAndType(fileUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, false);
            activity.startActivity(intent);
        } catch (Exception error) {
            status = "Cannot open Android installer: " + error.getMessage();
            send();
            Toast.makeText(activity, "Unable to open installer. Check TV install permissions.", Toast.LENGTH_LONG).show();
        }
    }
    private String loadPublishedChecksum(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestProperty("User-Agent", "Vela-Android-TV-Updater");
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(7000);
        try {
            if (connection.getResponseCode() != 200 || !"https".equalsIgnoreCase(connection.getURL().getProtocol()))
                throw new IllegalStateException("Release checksum download failed");
            byte[] data;
            try (InputStream in = connection.getInputStream()) { data = readBounded(in, 200); }
            String value = new String(data, "UTF-8").trim();
            if (!value.matches("[a-fA-F0-9]{64}(\\s+\\*?Vela-release\\.apk)?"))
                throw new IllegalStateException("Invalid release checksum");
            return value.substring(0, 64).toLowerCase(Locale.US);
        } finally { connection.disconnect(); }
    }
    private void download(String address, long length, File file) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("User-Agent", "Vela-Android-TV-Updater");
        if (connection.getResponseCode() != 200) throw new IllegalStateException("APK download HTTP " + connection.getResponseCode());
        if (!"https".equalsIgnoreCase(connection.getURL().getProtocol()))
            throw new SecurityException("APK download did not use HTTPS");
        long total = 0; int lastProgress = -1;
        try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
            byte[] buffer = new byte[16384]; int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_APK_BYTES || total > length) throw new IllegalStateException("APK download exceeds expected size");
                out.write(buffer, 0, read);
                int percent = (int)(100L * total / length);
                if (percent / 10 > lastProgress) {
                    lastProgress = percent / 10;
                    status = "Downloading update: " + percent + "%"; send();
                }
            }
        } finally { connection.disconnect(); }
        if (total != length) throw new IllegalStateException("APK download was incomplete");
    }
    private static byte[] readBounded(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) >= 0) {
            if (out.size() + n > max) throw new IllegalStateException("GitHub response too large");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }
    private static String sha256(File f) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[16384]; int n;
            while ((n = in.read(b)) > 0) digest.update(b, 0, n);
        }
        StringBuilder s = new StringBuilder(64);
        for (byte b : digest.digest()) s.append(String.format(Locale.US, "%02x", b & 0xff));
        return s.toString();
    }
    void shutdown() { worker.shutdownNow(); }
}
