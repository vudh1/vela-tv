package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Quiet, global weather cache shared by Android Home and native screensaver.
 * All network work happens on one worker; no IP address or router details persist.
 */
final class VelaWeatherRepository {
    interface Listener { void onWeather(String json); }
    private static final long WEATHER_TTL = 10 * 60_000L;
    private static final long LOCATION_TTL = 30 * 60_000L;
    private static final long MAX_AGE = 90 * 60_000L;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "VelaWeather"); t.setDaemon(true);t.setPriority(Thread.MIN_PRIORITY);return t;
    });
    private static final AtomicBoolean busy = new AtomicBoolean(false);
    private VelaWeatherRepository() {}
    private static SharedPreferences preferences(Context c) {
        return c.getApplicationContext().getSharedPreferences("quiet-home", Context.MODE_PRIVATE);
    }
    private static boolean finite(double value, double min, double max) {
        return !Double.isNaN(value) && !Double.isInfinite(value) && value >= min && value <= max;
    }
    static String cached(Context ctx) {
        try {
            JSONObject data = new JSONObject(preferences(ctx).getString("weather_cache_v1", "{}"));
            long age = System.currentTimeMillis() - data.optLong("updatedAt", 0);
            if (age >= 0 && age < MAX_AGE && finite(data.optDouble("temperature", Double.NaN), -140, 140))
                return data.toString();
        } catch (Exception ignored) {}
        return "";
    }
    static void refresh(Context ctx, Listener listener) {
        Context app = ctx.getApplicationContext();
        String last = cached(app);
        if (!last.isEmpty() && listener != null) listener.onWeather(last);
        try {
            if (!last.isEmpty() && System.currentTimeMillis() - new JSONObject(last).optLong("updatedAt") < WEATHER_TTL) return;
        } catch (Exception ignored) {}
        if (!busy.compareAndSet(false, true)) return;
        IO.execute(() -> {
            try {
                JSONObject location = getLocation(app);
                if (location == null) return;
                JSONObject next = getWeather(location);
                preferences(app).edit().putString("weather_cache_v1", next.toString()).apply();
                if (listener != null) listener.onWeather(next.toString());
            } catch (Exception ignored) {
                // Network, IP lookup, or provider failures never interfere with the launcher.
            } finally { busy.set(false); }
        });
    }
    private static JSONObject getLocation(Context ctx) throws Exception {
        SharedPreferences p = preferences(ctx);
        JSONObject known = null;
        try {known = new JSONObject(p.getString("weather_location_v1", "{}"));}catch(Exception ignored){}
        long now = System.currentTimeMillis();
        if (known != null && now - known.optLong("at", 0) < LOCATION_TTL &&
            finite(known.optDouble("latitude", Double.NaN), -90, 90) &&
            finite(known.optDouble("longitude", Double.NaN), -180, 180)) return known;
        JSONObject incoming = fetch("https://ip-info.com/json");
        double lat = incoming.optDouble("latitude", Double.NaN), lon = incoming.optDouble("longitude", Double.NaN);
        if (!finite(lat, -90, 90) || !finite(lon, -180, 180)) throw new IllegalStateException("No IP coordinates");
        JSONObject location = new JSONObject();
        location.put("latitude", lat).put("longitude", lon)
            .put("city", clean(incoming.optString("city", "")))
            .put("region", clean(incoming.optString("region_code", incoming.optString("region", ""))))
            .put("country", clean(incoming.optString("country", ""))).put("at", now);
        p.edit().putString("weather_location_v1", location.toString()).apply();
        return location;
    }
    private static String clean(String value) {
        if (value == null || "null".equals(value)) return "";
        String safe = value.replaceAll("[\\x00-\\x1F<>]", "").trim();
        return safe.substring(0, Math.min(65, safe.length()));
    }
    private static JSONObject getWeather(JSONObject g) throws Exception {
        boolean us = "US".equals(g.optString("country"));
        String url = "https://api.open-meteo.com/v1/forecast?latitude=" + g.getDouble("latitude") +
            "&longitude=" + g.getDouble("longitude") +
            "&current=temperature_2m,weather_code,precipitation,is_day" +
            "&hourly=precipitation_probability&timezone=UTC&forecast_hours=3" +
            (us ? "&temperature_unit=fahrenheit&precipitation_unit=inch" : "");
        JSONObject weather = fetch(url), current = weather.getJSONObject("current");
        double temperature = current.optDouble("temperature_2m", Double.NaN);
        double precipitation = current.optDouble("precipitation", Double.NaN);
        if (!finite(temperature,-140,140) || !finite(precipitation,0,1000))
            throw new IllegalStateException("Missing current weather");
        int code = current.optInt("weather_code", 3);
        String[] status = condition(code);
        Object chance = JSONObject.NULL;
        JSONArray hourly = weather.optJSONObject("hourly") == null ? null :
            weather.optJSONObject("hourly").optJSONArray("precipitation_probability");
        if (hourly != null) for (int i = 0; i < hourly.length(); i++) {
            double n = hourly.optDouble(i, Double.NaN);
            if (finite(n,0,100)){chance = (int)Math.round(n);break;}
        }
        return new JSONObject().put("city",g.optString("city", ""))
            .put("region",g.optString("region", ""))
            .put("country",g.optString("country", ""))
            .put("temperature",temperature).put("unit",us?"F":"C")
            .put("precipitation",precipitation).put("precipUnit",us?"in":"mm")
            .put("rainChance",chance).put("condition",status[0]).put("kind",status[1])
            .put("updatedAt",System.currentTimeMillis());
    }
    private static String[] condition(int code) {
        if (code == 0) return new String[]{"Clear", "sun"};
        if (code <= 2) return new String[]{"Partly cloudy", "cloud"};
        if (code == 3) return new String[]{"Overcast", "cloud"};
        if (code == 45 || code == 48) return new String[]{"Foggy", "cloud"};
        if (code >= 51 && code <= 57) return new String[]{"Drizzle", "rain"};
        if (code >= 61 && code <= 67) return new String[]{"Rain", "rain"};
        if (code >= 71 && code <= 77) return new String[]{"Snow", "snow"};
        if (code >= 80 && code <= 82) return new String[]{"Showers", "rain"};
        if (code >= 85 && code <= 86) return new String[]{"Snow showers", "snow"};
        if (code >= 95) return new String[]{"Thunderstorms", "rain"};
        return new String[]{"Cloudy", "cloud"};
    }
    private static JSONObject fetch(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(5500);connection.setReadTimeout(5500);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "VelaTV/2.6 (personal home weather)");
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException("Weather provider unavailable");
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] chunk = new byte[4096];int n;
                while ((n=in.read(chunk))!=-1) {
                    bytes.write(chunk,0,n);
                    if(bytes.size()>160_000)throw new IllegalStateException("Weather response too large");
                }
                return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {connection.disconnect();}
    }
}
