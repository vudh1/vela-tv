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
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** TV-initiated HTTPS relay. The TV generates a one-time-displayed PIN;
 * Cloudflare holds a salted hash, not a PIN copied from GitHub Secrets.
 * Up to four controllers are independently authorized by a PIN, matching
 * public-IP exit, and separately authenticated leases. Keys come from Cloudflare.
 */
final class VelaRemoteClient {
    static final String API = "https://velatv-remote.vudhone.workers.dev";
    private static final String KEY_ALIAS = "VelaRemoteCredential_v1";
    private static volatile VelaRemoteClient instance;
    private final Context context;
    private final VelaRemoteText secureText;
    private final SharedPreferences prefs;
    private volatile boolean polling;
    private volatile long generation;
    private volatile String cachedToken;
    private final AtomicBoolean generatingPin = new AtomicBoolean(false);

    private VelaRemoteClient(Context c) {
        context = c.getApplicationContext();
        secureText = new VelaRemoteText(context);
        prefs = context.getSharedPreferences("vela-remote", Context.MODE_PRIVATE);
        // Migration: old builds retained a reversible PIN for "Show PIN".
        // The owner now generates a fresh PIN if pairing another phone.
        if (prefs.contains("pin_encrypted")) prefs.edit().remove("pin_encrypted").apply();
    }
    static synchronized VelaRemoteClient get(Context context) {
        if (instance == null) instance = new VelaRemoteClient(context);
        return instance;
    }
    boolean enabled() { return prefs.getBoolean("enabled", false) && token().length() == 64; }
    boolean revocationPending() { return !prefs.getBoolean("enabled", false) && token().length() == 64; }
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
    static String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
        byte[] iv = cipher.getIV(), bytes = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + bytes.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(bytes, 0, all, iv.length, bytes.length);
        return Base64.encodeToString(all, Base64.NO_WRAP);
    }
    static String decrypt(String stored) {
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
    interface PinCallback { void done(String pin, String error); }
    private static String freshPin() {
        SecureRandom random = new SecureRandom();
        StringBuilder digits = new StringBuilder(10);
        for (int i = 0; i < 10; i++) digits.append(random.nextInt(10));
        return digits.toString();
    }
    void generatePin(PinCallback callback) {
        if (revocationPending()) {
            callback.done("", "Finish revoking the previous TV connection first.");
            return;
        }
        if (!generatingPin.compareAndSet(false, true)) {
            callback.done("", "A remote PIN is already being generated.");
            return;
        }
        new Thread(() -> {
            boolean rotating = enabled();
            try {
                String pin = freshPin();
                String deviceToken = token();
                if (deviceToken.length() != 64) {
                    byte[] seed = new byte[32]; new SecureRandom().nextBytes(seed);
                    StringBuilder sb = new StringBuilder();
                    for (byte b : seed) sb.append(String.format(java.util.Locale.US, "%02x", b & 255));
                    deviceToken = sb.toString();
                }
                // Encrypt before enrollment to avoid an unreachable enrollment
                // if local secure storage is unavailable.
                String sealedToken = encrypt(deviceToken);
                JSONObject payload = new JSONObject();
                payload.put("pin", pin);
                if (!rotating) payload.put("tvToken", deviceToken);
                JSONObject answer = post(rotating ? "/api/tv/pin" : "/api/tv/enroll",
                    rotating ? deviceToken : "", payload);
                if (!answer.optBoolean("ok")) throw new Exception("Enrollment rejected");
                prefs.edit().putString("token_encrypted", sealedToken)
                    .remove("pin_encrypted").putBoolean("enabled", true).apply();
                cachedToken = deviceToken;
                start();
                callback.done(pin, "");
            } catch (Exception ex) {
                callback.done("", "Remote HTTP 409".equals(ex.getMessage()) && rotating
                    ? "Four phones are already paired. Disconnect one, or disable remote access to reset all."
                    : "Could not generate a remote PIN. Check the network or try again.");
            } finally { generatingPin.set(false); }
        }, "VelaRemoteGeneratePin").start();
    }
    void disable(Callback callback) {
        String oldToken = token();
        // Stop locally immediately, but retain the encrypted device credential
        // until Cloudflare confirms revocation. An offline failure must not
        // strand the owner with an irrevocably enrolled device.
        prefs.edit().putBoolean("enabled", false).apply();
        polling = false;
        generation++;
        new Thread(() -> {
            try { if (oldToken.length() == 64) post("/api/tv/disable", oldToken, new JSONObject());
                prefs.edit().remove("token_encrypted").remove("pin_encrypted").apply();
                cachedToken = "";
                callback.done("Remote access disabled."); }
            catch (Exception ex) { callback.done("Remote paused. Revoke again when Cloudflare is reachable."); }
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
                    JSONObject poll = new JSONObject();
                    String textPublicKey = secureText.publicKey();
                    if (!textPublicKey.isEmpty()) poll.put("textPublicKey", textPublicKey);
                    JSONObject answer = post("/api/tv/poll", token(), poll);
                    // Check on every active poll: the owner might reopen the
                    // PIN dialog while an already-paired controller is online.
                    if (answer.optBoolean("active") && !answer.optBoolean("pinPending"))
                        MainActivity.remoteControllerConnected();
                    JSONArray commands = answer.optJSONArray("commands");
                    if (commands != null) for (int i = 0; i < commands.length() && i < 16; i++) {
                        String key = commands.optJSONObject(i) == null ? "" : commands.optJSONObject(i).optString("key");
                        if ("type_text".equals(key)) {
                            String plain = secureText.decrypt(commands.optJSONObject(i).optJSONObject("payload"));
                            if (plain != null) handleText(plain);
                        } else if (allowed(key)) handleKey(key);
                    }
                    // Full speed briefly after an input, economical otherwise.
                    if (answer.optBoolean("active"))
                        // Low latency only during a recent remote interaction
                        // or when the phone has just opened the controller.
                        // Idle clients keep the free-tier-friendly cadence.
                        next = answer.optBoolean("fast") ? 180 : 2_500;
                } catch (Exception ex) {
                    if ("Remote HTTP 401".equals(ex.getMessage())) {
                        // An unconfirmed pairing may have expired, or the TV
                        // may have been revoked on Cloudflare. Local recovery
                        // must not require a cloud-side manual reset.
                        prefs.edit().putBoolean("enabled", false)
                            .remove("token_encrypted").remove("pin_encrypted").apply();
                        cachedToken = "";
                        break;
                    }
                    next = 15_000;
                }
                try { Thread.sleep(next); } catch (InterruptedException ignored) { break; }
            }
        } finally { synchronized (this) { if (generation == epoch) polling = false; } }
    }
    private static boolean allowed(String key) {
        switch (key) {
            case "up": case "down": case "left": case "right": case "select":
            case "back": case "home": case "volume_up": case "volume_down":
            case "mute": case "play_pause": case "settings":
            case "wifi_settings": case "power_toggle": case "power_off": case "input":
            case "hdmi1": case "hdmi2": case "hdmi3": case "hdmi4": return true;
            default: return false;
        }
    }
    private void handleText(String text) {
        new Handler(Looper.getMainLooper()).post(() -> {
            VelaRemoteAccessibilityService service = VelaRemoteAccessibilityService.active();
            if (service != null) service.applyText(text);
        });
    }
    private void handleKey(String key) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if ("volume_up".equals(key) || "volume_down".equals(key) || "mute".equals(key)) {
                // The Sony remote protocol traverses the TV's native ARC/CEC
                // audio path and may display its real indicator. Only use
                // Android volume as fallback; never apply both (double step).
                VelaSonyIpControl.get(context).send(key, () -> androidVolume(key));
                return;
            }
            if ("settings".equals(key)) {
                MainActivity.openRemoteSettings(context);
                return;
            }
            if ("wifi_settings".equals(key)) {
                MainActivity.openRemoteWifiSettings(context);
                return;
            }
            if ("power_toggle".equals(key) || "power_off".equals(key)
                    || "input".equals(key) || key.startsWith("hdmi")) {
                // Remote device controls are deliberately unavailable without
                // an owner-configured Sony key. Never pretend an action worked.
                VelaSonyIpControl sony = VelaSonyIpControl.get(context);
                if (sony.enabled()) sony.send(key, () ->
                    android.widget.Toast.makeText(context, "Sony TV control unavailable. Check Vela Settings.", android.widget.Toast.LENGTH_SHORT).show());
                else android.widget.Toast.makeText(context,
                    "Set up Sony IP control in Vela Settings first.", android.widget.Toast.LENGTH_SHORT).show();
                return;
            }
            if ("play_pause".equals(key)) {
                // Once a streaming app owns focus, Sony IRCC offers distinct
                // Play and Pause commands that Android media dispatch may ignore.
                if (!MainActivity.isRemoteHomeVisible() && VelaSonyIpControl.get(context).enabled()) {
                    VelaSonyIpControl.get(context).send(key, () -> androidPlayPause());
                    return;
                }
                androidPlayPause();
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
            VelaSonyIpControl.get(context).send(key, () -> {
                VelaRemoteAccessibilityService service = VelaRemoteAccessibilityService.active();
                if (service != null) service.applyKey(key);
            });
        });
    }
    private void androidVolume(String key) {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        try {
            if (audio.isVolumeFixed()) return;
            int direction = "mute".equals(key) ? AudioManager.ADJUST_TOGGLE_MUTE :
                "volume_up".equals(key) ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
            audio.adjustVolume(direction, AudioManager.FLAG_SHOW_UI);
        } catch (RuntimeException ignored) { /* TV audio remains authoritative. */ }
    }
    private void androidPlayPause() {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null) {
            try {
                long now = android.os.SystemClock.uptimeMillis();
                audio.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0));
                audio.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0));
            } catch (SecurityException ignored) { }
        }
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
