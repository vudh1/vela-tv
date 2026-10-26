package com.danielvu.quiethome;

/** Only restore Vela when its Home was underneath the native Android dream. */
final class VelaDreamReturnPolicy {
    // Android pauses the Activity as it presents the DreamService window.
    // Allow a short lifecycle gap, but never reuse a stale pause from a streaming app.
    static final long HOME_PAUSE_GRACE_MS = 4000L;

    private VelaDreamReturnPolicy() { }

    static boolean beganOverVela(boolean homeResumed, long pausedAtElapsed, long dreamStartedElapsed) {
        return homeResumed || (pausedAtElapsed > 0L
            && dreamStartedElapsed >= pausedAtElapsed
            && dreamStartedElapsed - pausedAtElapsed <= HOME_PAUSE_GRACE_MS);
    }

    static boolean shouldOpenVela(boolean beganOverVela, boolean screenInteractive, boolean alreadyOpened) {
        return beganOverVela && screenInteractive && !alreadyOpened;
    }
}
