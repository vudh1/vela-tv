package com.danielvu.quiethome;

/** One user-requested install can open Android's unknown-source settings at most once. */
final class VelaInstallPermissionFlow {
    enum Action { INSTALL, OPEN_SETTINGS, BLOCKED }

    private boolean settingsOpened;
    private boolean awaitingReturn;

    Action onInstallRequest(boolean permitted) {
        if (permitted) {
            awaitingReturn = false;
            settingsOpened = false;
            return Action.INSTALL;
        }
        if (settingsOpened) return Action.BLOCKED;
        settingsOpened = true;
        awaitingReturn = true;
        return Action.OPEN_SETTINGS;
    }

    /** Null means no source-permission screen was opened by Vela. */
    Action onResume(boolean permitted) {
        if (!awaitingReturn) return null;
        awaitingReturn = false;
        if (permitted) {
            settingsOpened = false;
            return Action.INSTALL;
        }
        return Action.BLOCKED;
    }
}
