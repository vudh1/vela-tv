package com.danielvu.quiethome;

public final class SonyIrccMessageTest {
    private static void check(boolean ok, String label) {
        if (!ok) throw new AssertionError(label);
    }

    public static void main(String[] args) {
        check("AAAAAQAAAAEAAAB0Aw==".equals(SonyIrccMessage.code("up", true)), "up");
        check("AAAAAQAAAAEAAABlAw==".equals(SonyIrccMessage.code("select", true)), "select");
        check("AAAAAgAAAJcAAAAjAw==".equals(SonyIrccMessage.code("back", true)), "back");
        check("AAAAAQAAAAEAAAASAw==".equals(SonyIrccMessage.code("volume_up", true)), "volume up");
        check("AAAAAQAAAAEAAAATAw==".equals(SonyIrccMessage.code("volume_down", true)), "volume down");
        check("AAAAAQAAAAEAAAAUAw==".equals(SonyIrccMessage.code("mute", true)), "mute");
        check("AAAAAQAAAAEAAAAvAw==".equals(SonyIrccMessage.code("power_off", true)), "standby");
        check("AAAAAQAAAAEAAAAVAw==".equals(SonyIrccMessage.code("power_toggle", true)), "Sony power toggle");
        check("AAAAAQAAAAEAAAAlAw==".equals(SonyIrccMessage.code("input", true)), "input menu");
        check("AAAAAgAAABoAAABaAw==".equals(SonyIrccMessage.code("hdmi1", true)), "HDMI 1");
        check("AAAAAgAAABoAAABdAw==".equals(SonyIrccMessage.code("hdmi4", true)), "HDMI 4");
        check("AAAAAgAAAJcAAAAZAw==".equals(SonyIrccMessage.code("play_pause", true)), "pause");
        check("AAAAAgAAAJcAAAAaAw==".equals(SonyIrccMessage.code("play_pause", false)), "play");
        for (String denied : new String[]{"power", "home", "settings", "http://host", "../../", ""})
            check(SonyIrccMessage.code(denied, true).isEmpty(), "deny command " + denied);
        String xml = SonyIrccMessage.envelope(SonyIrccMessage.code("up", true));
        check(xml.contains("<IRCCCode>AAAAAQAAAAEAAAB0Aw==</IRCCCode>"), "correct envelope");
        check(xml.contains("X_SendIRCC"), "SOAP action");
        check(SonyIrccMessage.validPsk("Sony-Private-2026"), "strong key");
        for (String denied : new String[]{"short", "contains space", "header\nX-Auth-PSK", "a_very_long_password_more_than_twenty"})
            check(!SonyIrccMessage.validPsk(denied), "deny PSK " + denied.replace("\n", "\\n"));
        System.out.println("PASS Sony IRCC allowed codes, SOAP envelope and PSK validation");
    }
}
