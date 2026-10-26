package com.danielvu.quiethome;

public final class VelaCalendarPolicyTest {
    private static void check(boolean condition, String explanation) {
        if (!condition) throw new AssertionError(explanation);
    }

    public static void main(String[] args) {
        String token = "A".repeat(42) + "_";
        String stable = "https://ballerwatch-web.vudhone.workers.dev/web/v1/calendar-ics/" + token + ".ics";
        String legacy = "https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics?teams=sea&pickup=1&watch=all";
        String google = "https://calendar.google.com/calendar/ical/synthetic/private-synthetic/basic.ics";
        check(VelaCalendarPolicy.approved(stable) && VelaCalendarPolicy.stableBallerWatch(stable), "Stable capability accepted");
        check(VelaCalendarPolicy.approved(legacy), "Legacy BallerWatch ICS preserved");
        check(VelaCalendarPolicy.approved(google), "Google ICS preserved");
        check(!VelaCalendarPolicy.approved(stable + "?leak=1"), "Stable capability forbids query parameters");
        check(!VelaCalendarPolicy.approved(stable.replace(token, "short")), "Invalid token shape rejected");
        check(!VelaCalendarPolicy.approved(stable.replace(".dev", ".dev.evil.org")), "Lookalike host rejected");
        check(!VelaCalendarPolicy.approved(stable.replace("https:", "http:")), "Plain HTTP rejected");
        check(!VelaCalendarPolicy.approved(stable + "#private"), "Fragments rejected");
        check(!VelaCalendarPolicy.approved(legacy + "&unsafe=1"), "Unknown legacy parameter rejected");
        check(VelaCalendarPolicy.revokedStableFeed(stable, 404), "Deleted token revokes");
        check(VelaCalendarPolicy.revokedStableFeed(stable, 410), "Expired token revokes");
        check(!VelaCalendarPolicy.revokedStableFeed(stable, 429), "Quota failure retains last-good data");
        check(!VelaCalendarPolicy.revokedStableFeed(stable, 503), "Offline failure retains last-good data");
        check(!VelaCalendarPolicy.revokedStableFeed(legacy, 404), "Legacy 404 does not silently remove existing link");
        System.out.println("PASS calendar URL allowlist, legacy Google/ICS, revoked-vs-offline policy");
    }
}
