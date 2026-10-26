package com.danielvu.quiethome;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Pure-Java calendar URL and revocation rules, shared by Android and unit tests. */
final class VelaCalendarPolicy {
    private static final String BALLERWATCH = "ballerwatch-web.vudhone.workers.dev";
    private static final Set<String> LEGACY_KEYS = new HashSet<>(Arrays.asList("teams", "pickup", "watch"));

    static boolean stableBallerWatch(String value) {
        try {
            URI uri = new URI(value.trim());
            return "https".equalsIgnoreCase(uri.getScheme()) && BALLERWATCH.equalsIgnoreCase(uri.getHost())
                && uri.getPort() == -1 && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                && uri.getRawQuery() == null && uri.getRawPath() != null
                && uri.getRawPath().matches("/web/v1/calendar-ics/[A-Za-z0-9_-]{43}\\.ics");
        } catch (Exception ignored) { return false; }
    }

    static boolean revokedStableFeed(String url, int httpStatus) {
        return (httpStatus == 404 || httpStatus == 410) && stableBallerWatch(url);
    }

    static boolean approved(String value) {
        if (value == null || value.length() > 4096) return false;
        try {
            URI uri = new URI(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getPort() != -1
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                || uri.getHost() == null || uri.getRawPath() == null) return false;
            if ("calendar.google.com".equalsIgnoreCase(uri.getHost()))
                return uri.getRawPath().startsWith("/calendar/ical/") && uri.getRawPath().endsWith(".ics");
            if (!BALLERWATCH.equalsIgnoreCase(uri.getHost())) return false;
            if (stableBallerWatch(value)) return true;
            if (!"/web/calendar.ics".equals(uri.getRawPath())) return false;
            String query = uri.getRawQuery();
            if (query == null || query.isEmpty()) return true;
            for (String pair : query.split("&", -1)) {
                String key = pair.split("=", 2)[0].toLowerCase(Locale.ROOT);
                if (!LEGACY_KEYS.contains(key)) return false;
            }
            return true;
        } catch (Exception ignored) { return false; }
    }
}
