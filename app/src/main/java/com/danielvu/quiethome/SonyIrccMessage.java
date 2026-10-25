package com.danielvu.quiethome;

/** Sony BRAVIA IRCC-IP request encoding. All accepted commands are allowlisted. */
final class SonyIrccMessage {
    private SonyIrccMessage() { }

    static String code(String command, boolean pause) {
        switch (command) {
            case "up": return "AAAAAQAAAAEAAAB0Aw==";
            case "down": return "AAAAAQAAAAEAAAB1Aw==";
            case "right": return "AAAAAQAAAAEAAAAzAw==";
            case "left": return "AAAAAQAAAAEAAAA0Aw==";
            case "select": return "AAAAAQAAAAEAAABlAw==";
            case "back": return "AAAAAgAAAJcAAAAjAw==";
            // Send the same commands as Sony's physical volume keys so its
            // HDMI-ARC/CEC audio path may also display the native volume HUD.
            case "volume_up": return "AAAAAQAAAAEAAAASAw==";
            case "volume_down": return "AAAAAQAAAAEAAAATAw==";
            case "mute": return "AAAAAQAAAAEAAAAUAw==";
            // Sony's physical remote Power key toggles on/off when IRCC is
            // reachable. When Vela stops polling during standby, the cloud
            // remote cannot deliver a second command to wake the TV.
            case "power_toggle": return "AAAAAQAAAAEAAAAVAw==";
            // Preserve the older discrete standby key for existing clients.
            case "power_off": return "AAAAAQAAAAEAAAAvAw==";
            case "input": return "AAAAAQAAAAEAAAAlAw==";
            case "hdmi1": return "AAAAAgAAABoAAABaAw==";
            case "hdmi2": return "AAAAAgAAABoAAABbAw==";
            case "hdmi3": return "AAAAAgAAABoAAABcAw==";
            case "hdmi4": return "AAAAAgAAABoAAABdAw==";
            // Sony's IRCC interface has separate Play/Pause, not a toggle code.
            // First tap of the phone's combined button pauses; next plays.
            case "play_pause": return pause ? "AAAAAgAAAJcAAAAZAw==" : "AAAAAgAAAJcAAAAaAw==";
            default: return "";
        }
    }

    static String envelope(String code) {
        if (!code.matches("[A-Za-z0-9+/]{18}==")) throw new IllegalArgumentException("Invalid IRCC code");
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
            + "<s:Body><u:X_SendIRCC xmlns:u=\"urn:schemas-sony-com:service:IRCC:1\">"
            + "<IRCCCode>" + code + "</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>";
    }

    static boolean validPsk(String psk) {
        if (psk == null || psk.length() < 8 || psk.length() > 20) return false;
        for (int i = 0; i < psk.length(); i++) {
            char c = psk.charAt(i);
            // Reject header control characters and Unicode normalization issues.
            if (c < 0x21 || c > 0x7e) return false;
        }
        return true;
    }
}
