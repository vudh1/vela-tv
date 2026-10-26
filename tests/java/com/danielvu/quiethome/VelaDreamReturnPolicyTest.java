package com.danielvu.quiethome;

public final class VelaDreamReturnPolicyTest {
    private static void verify(boolean actual, boolean expected, String caseName) {
        if (actual != expected) throw new AssertionError(caseName);
    }

    public static void main(String[] args) {
        verify(VelaDreamReturnPolicy.beganOverVela(true, 0, 9000), true, "home still foreground");
        verify(VelaDreamReturnPolicy.beganOverVela(false, 7000, 9000), true, "home paused for dream");
        verify(VelaDreamReturnPolicy.beganOverVela(false, 5000, 9000), true, "lifecycle edge");
        verify(VelaDreamReturnPolicy.beganOverVela(false, 4999, 9000), false, "earlier app switch");
        verify(VelaDreamReturnPolicy.beganOverVela(false, 0, 9000), false, "not running");
        verify(VelaDreamReturnPolicy.beganOverVela(false, 9100, 9000), false, "future timestamp");
        verify(VelaDreamReturnPolicy.shouldOpenVela(true, true, false), true, "user wakes Vela dream");
        verify(VelaDreamReturnPolicy.shouldOpenVela(false, true, false), false, "dream over other app");
        verify(VelaDreamReturnPolicy.shouldOpenVela(true, false, false), false, "TV sleeping");
        verify(VelaDreamReturnPolicy.shouldOpenVela(true, true, true), false, "one launch only");
        System.out.println("VelaDreamReturnPolicyTest passed");
    }
}
