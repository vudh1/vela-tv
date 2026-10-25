package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.KeyEvent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** TV-initiated HTTPS relay. No incoming TV port, no ADB, no plaintext PIN on disk.
 * A controller is granted by Cloudflare only after the right PIN, matching
 * public-IP exit, and an exclusive lease. Keys are accepted only from Cloudflare.
 */
final class VelaRemoteClient {
    static final String API = "https://velatv-remote.vudhone.workers.dev";
    private static final String KEY_ALIAS = "VelaRemoteCredential_v1";
    private static volatile VelaRemoteClient instance;
    private final Context context;
    private final SharedPreferences prefs;
    private volatile boolean polling;
    private volatile long generation;
    private volatile String cachedToken;

    private VelaRemoteClient(Context c) {
        context = c.getApplicationContext();
        prefs = context.getSharedPreferences("vela-remote", Context.MODE_PRIVATE);
    }
    static synchronized VelaRemoteClient get(Context context) {
        if (instance == null) instance = new VelaRemoteClient(context);
        return instance;
    }
    boolean enabled() { return prefs.getBoolean("enabled", false) && token().length() == 64; }
    private String token() {
        if (cachedToken != null) return cachedToken;
        cachedToken = decrypt(prefs.getString("token_encrypted", ""));
        return cachedToken;
    }
    private static SecretKey encryptionKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry)ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    private static String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
        byte[] iv = cipher.getIV(), bytes = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + bytes.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(bytes, 0, all, iv.length, bytes.length);
        return Base64.encodeToString(all, Base64.NO_WRAP);
    }
    private static String decrypt(String stored) {
        if (stored == null || stored.isEmpty()) return "";
        try {
            byte[] bytes = Base64.decode(stored, Base64.DEFAULT);
            if (bytes.length < 29) return "";
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, bytes, 0, 12));
            return new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8);
        } catch (Exception ignored) { return ""; }
    }

    interface Callback { void done(String message); }
    void enroll(String pin, Callback callback) {
        if (pin == null || !pin.matches("[0-9]{8,12}")) { callback.done("Enter an 8–12 digit PIN"); return; }
        final String submittedPin = pin; // never persisted or logged
        new Thread(() -> {
            try {
                String deviceToken = token();
                if (deviceToken.length() != 64) {
                    byte[] seed = new byte[32]; new SecureRandom().nextBytes(seed);
                    StringBuilder sb = new StringBuilder();
                    for (byte b : seed) sb.append(String.format(java.util.Locale.US, "%02x", b & 255));
                    deviceToken = sb.toString();
                }
                JSONObject payload = new JSONObject();
                payload.put("pin", submittedPin); payload.put("tvToken", deviceToken);
                JSONObject answer = post("/api/tv/enroll", "", payload);
                if (!answer.optBoolean("ok")) throw new Exception("Enrollment rejected");
                String sealedToken = encrypt(deviceToken);
                prefs.edit().putString("token_encrypted", sealedToken).putBoolean("enabled", true).apply();
                cachedToken = deviceToken;
                start();
                callback.done("Remote connected. Enable accessibility for other apps.");
            } catch (Exception ex) { callback.done("Could not pair. Check your Cloudflare PIN and Worker setup."); }
        }, "VelaRemoteEnroll").start();
    }
    void disable(Callback callback) {
        String oldToken = token();
        prefs.edit().remove("token_encrypted").putBoolean("enabled", false).apply();
        cachedToken = "";
        polling = false;
        generation++;
        new Thread(() -> {
            try { if (oldToken.length() == 64) post("/api/tv/disable", oldToken, new JSONObject());
                callback.done("Remote access disabled."); }
            catch (Exception ex) { callback.done("Remote disabled on TV; revoke its enrollment in Cloudflare before re-pairing."); }
        }, "VelaRemoteDisable").start();
    }
    synchronized void start() {
        if (polling || !enabled()) return;
        polling = true;
        long epoch = ++generation;
        Thread worker = new Thread(() -> pollLoop(epoch), "VelaRemotePoll");
        worker.setDaemon(true);
        worker.start();
    }
    private void pollLoop(long epoch) {
        try {
            while (polling && generation == epoch && enabled()) {
                long next = 7_000; // idle: ~12k requests/day, below free-tier limits
                try {
                    JSONObject answer = post("/api/tv/poll", token(), new JSONObject());
                    JSONArray commands = answer.optJSONArray("commands");
                    if (commands != null) for (int i = 0; i < commands.length() && i < 16; i++) {
                        String key = commands.optJSONObject(i) == null ? "" : commands.optJSONObject(i).optString("key");
                        if (allowed(key)) handleKey(key);
                    }
                    // Full speed briefly after an input, economical otherwise.
                    if (answer.optBoolean("active"))
                        next = answer.optBoolean("fast") ? 400 : 1_500;
                } catch (Exception ignored) { next = 15_000; }
                try { Thread.sleep(next); } catch (InterruptedException ignored) { break; }
            }
        } finally { synchronized (this) { if (generation == epoch) polling = false; } }
    }
    private static boolean allowed(String key) {
        switch (key) {
            case "up": case "down": case "left": case "right": case "select":
            case "back": case "home": case "volume_up": case "volume_down":
            case "mute": case "play_pause": return true;
            default: return false;
        }
    }
    private void handleKey(String key) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if ("volume_up".equals(key) || "volume_down".equals(key) || "mute".equals(key)) {
                AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                if (audio != null) {
                    try {
                        if ("mute".equals(key)) audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, 0);
                        else audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                            "volume_up".equals(key) ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER, 0);
                    } catch (SecurityException ignored) { }
                }
                return;
            }
            if ("play_pause".equals(key)) {
                AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                if (audio != null) {
                    try {
                        long now = android.os.SystemClock.uptimeMillis();
                        audio.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0));
                        audio.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0));
                    } catch (SecurityException ignored) { }
                }
                return;
            }
            if ("home".equals(key)) {
                if (MainActivity.acceptRemoteKey("home")) return;
                // Explicitly open Vela; do not require or disable the Sony launcher.
                android.content.Intent open = new android.content.Intent(context, MainActivity.class);
                open.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
                try { context.startActivity(open); } catch (Exception ignored) { }
                return;
            }
            if (MainActivity.acceptRemoteKey(key)) return;
            VelaRemoteAccessibilityService service = VelaRemoteAccessibilityService.active();
            if (service != null) service.applyKey(key);
        });
    }
    private JSONObject post(String path, String bearer, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(API + path).openConnection();
        connection.setConnectTimeout(5_000); connection.setReadTimeout(6_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("content-type", "application/json");
        if (!bearer.isEmpty()) connection.setRequestProperty("authorization", "Bearer " + bearer);
        connection.setDoOutput(true);
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        int status = connection.getResponseCode();
        if (status != 200) { connection.disconnect(); throw new Exception("Remote HTTP " + status); }
        try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[2048]; int size;
            while ((size = stream.read(chunk)) != -1) {
                if (out.size() + size > 16_384) throw new Exception("Remote response too large");
                out.write(chunk, 0, size);
            }
            return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
        } finally { connection.disconnect(); }
    }
}
