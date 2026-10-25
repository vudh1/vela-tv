package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/** Optional Sony IRCC-IP input in streaming apps on THIS TV.
 * Only loopback or the Android TV's own active-interface IPv4 is contacted.
 * Sony requires the PSK in a plaintext HTTP LAN header; never relay it to
 * Cloudflare, JavaScript, external domains, or another household device.
 */
final class VelaSonyIpControl {
    private static volatile VelaSonyIpControl instance;
    private final Context context;
    private final SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor(task -> {
        Thread worker = new Thread(task, "VelaSonyIrcc");
        worker.setDaemon(true);
        return worker;
    });
    private final AtomicInteger queued = new AtomicInteger();
    private final AtomicLong configurationEpoch = new AtomicLong();
    private volatile String lastHost = "";
    private boolean pauseNext = true;

    interface Callback { void done(String message); }

    private VelaSonyIpControl(Context app) {
        context = app.getApplicationContext();
        prefs = context.getSharedPreferences("vela-sony-ircc", Context.MODE_PRIVATE);
    }

    static synchronized VelaSonyIpControl get(Context context) {
        if (instance == null) instance = new VelaSonyIpControl(context);
        return instance;
    }

    boolean enabled() {
        return prefs.getBoolean("enabled", false)
            && SonyIrccMessage.validPsk(VelaRemoteClient.decrypt(prefs.getString("psk_encrypted", "")));
    }

    void configure(String psk, Callback callback) {
        if (!SonyIrccMessage.validPsk(psk)) {
            ui.post(() -> callback.done("Use an 8–20 character printable ASCII key (no spaces)."));
            return;
        }
        long epoch = configurationEpoch.incrementAndGet();
        io.execute(() -> {
            try {
                // Sending Up is an intentional, low-impact real IRCC test;
                // a public Sony discovery API can succeed even with a wrong PSK.
                String host = deliver("up", psk);
                String sealed = VelaRemoteClient.encrypt(psk);
                if (configurationEpoch.get() != epoch) return; // Removed during test.
                prefs.edit().putString("psk_encrypted", sealed).putBoolean("enabled", true).apply();
                lastHost = host;
                pauseNext = true;
                ui.post(() -> callback.done("Sony IP control connected. Try Netflix or YouTube navigation."));
            } catch (Exception ignored) {
                ui.post(() -> callback.done("Sony IP control test failed. Check IP control, authentication, and the key on the TV."));
            }
        });
    }

    void test(Callback callback) {
        if (!enabled()) { ui.post(() -> callback.done("Set up a Sony Pre-Shared Key first.")); return; }
        io.execute(() -> {
            try {
                String host = deliver("up", VelaRemoteClient.decrypt(prefs.getString("psk_encrypted", "")));
                lastHost = host;
                ui.post(() -> callback.done("Sony responded to an Up command. Now try the phone remote in Netflix/YouTube."));
            } catch (Exception ignored) {
                ui.post(() -> callback.done("Sony did not accept the test. Check IP control, network, and the saved key."));
            }
        });
    }

    void disable() {
        // A pending Save & test must not re-enable a key after explicit removal.
        configurationEpoch.incrementAndGet();
        // Pending jobs re-check enabled() before using the stored key.
        prefs.edit().putBoolean("enabled", false).remove("psk_encrypted").apply();
        lastHost = "";
        pauseNext = true;
    }

    /** Send on an ordered I/O worker. Fall back to Accessibility if IP fails. */
    void send(String key, Runnable fallback) {
        if (!enabled() || SonyIrccMessage.code(key, true).isEmpty()) {
            ui.post(fallback);
            return;
        }
        // Prevent stale keypresses replaying after a disconnected interface.
        if (queued.incrementAndGet() > 3) {
            queued.decrementAndGet();
            ui.post(fallback);
            return;
        }
        io.execute(() -> {
            try {
                if (!enabled() || !VelaRemoteClient.get(context).enabled()) { ui.post(fallback); return; }
                String psk = VelaRemoteClient.decrypt(prefs.getString("psk_encrypted", ""));
                String code = SonyIrccMessage.code(key, pauseNext);
                lastHost = deliverCode(code, psk);
                if ("play_pause".equals(key)) pauseNext = !pauseNext;
            } catch (Exception ignored) { ui.post(fallback); }
            finally { queued.decrementAndGet(); }
        });
    }

    private String deliver(String key, String psk) throws Exception {
        return deliverCode(SonyIrccMessage.code(key, true), psk);
    }

    private String deliverCode(String code, String psk) throws Exception {
        if (!SonyIrccMessage.validPsk(psk) || code.isEmpty()) throw new IllegalArgumentException("Configuration unavailable");
        Exception failure = null;
        for (String host : ownHosts()) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL("http://" + host + "/sony/ircc").openConnection();
                connection.setConnectTimeout(900);
                connection.setReadTimeout(1_500);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "text/xml; charset=UTF-8");
                connection.setRequestProperty("SOAPACTION", "\"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC\"");
                connection.setRequestProperty("X-Auth-PSK", psk);
                connection.setDoOutput(true);
                byte[] xml = SonyIrccMessage.envelope(code).getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = connection.getOutputStream()) { out.write(xml); }
                if (connection.getResponseCode() == 200) return host;
            } catch (Exception error) { failure = error; }
            finally { if (connection != null) connection.disconnect(); }
        }
        throw failure != null ? failure : new Exception("Sony IP control unavailable");
    }

    private List<String> ownHosts() {
        List<String> hosts = new ArrayList<>();
        try {
            ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network network = manager == null ? null : manager.getActiveNetwork();
            NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
            if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return hosts;
            LinkProperties link = manager.getLinkProperties(network);
            if (link != null) for (LinkAddress address : link.getLinkAddresses()) {
                InetAddress ip = address.getAddress();
                if (!(ip instanceof Inet4Address) || !ip.isSiteLocalAddress()) continue;
                String value = ip.getHostAddress();
                if (!hosts.contains(value)) hosts.add(value);
            }
        } catch (SecurityException ignored) { }
        // Prefer the TV's own LAN interface: consumer BRAVIA builds may not
        // listen on loopback, and trying it first delays every cold command.
        // Loopback stays a safe fallback and is never another household host.
        hosts.add("127.0.0.1");
        // A host cached before a Wi-Fi change may now belong to a different
        // LAN device. Only prioritize it if it is STILL this TV's own IP.
        if (!lastHost.isEmpty() && hosts.remove(lastHost)) hosts.add(0, lastHost);
        return hosts;
    }
}
