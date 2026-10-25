package com.danielvu.quiethome;

import android.accessibilityservice.AccessibilityService;
import android.view.View;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/** Opt-in. Reads only the currently focused accessibility node in response to
 * an authenticated remote command; never records screen content or text.
 * Some streaming apps intentionally omit usable accessibility focus nodes.
 */
public final class VelaRemoteAccessibilityService extends AccessibilityService {
    private static volatile VelaRemoteAccessibilityService current;
    static VelaRemoteAccessibilityService active() { return current; }
    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        current = this;
        VelaRemoteClient.get(this).start();
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }
    @Override public void onDestroy() { if (current == this) current = null; super.onDestroy(); }
    void applyKey(String key) {
        if ("back".equals(key)) { performGlobalAction(GLOBAL_ACTION_BACK); return; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused == null) focused = root.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
            if (focused == null) return;
            if ("select".equals(key)) { focused.performAction(AccessibilityNodeInfo.ACTION_CLICK); return; }
            int direction;
            switch (key) {
                case "up": direction = View.FOCUS_UP; break;
                case "down": direction = View.FOCUS_DOWN; break;
                case "left": direction = View.FOCUS_LEFT; break;
                case "right": direction = View.FOCUS_RIGHT; break;
                default: return;
            }
            AccessibilityNodeInfo next = focused.focusSearch(direction);
            if (next != null) {
                try { next.performAction(AccessibilityNodeInfo.ACTION_FOCUS); }
                finally { next.recycle(); }
            }
        } finally { root.recycle(); }
    }
}
