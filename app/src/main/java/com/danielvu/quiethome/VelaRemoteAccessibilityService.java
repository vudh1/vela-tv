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
            try {
                if ("select".equals(key)) {
                    // Netflix/YouTube sometimes focus a non-clickable child of
                    // a clickable card; walk upward without reading its text.
                    AccessibilityNodeInfo node = focused;
                    for (int level = 0; level < 5 && node != null; level++) {
                        if (node.isClickable() && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) break;
                        AccessibilityNodeInfo parent = node.getParent();
                        if (node != focused) node.recycle();
                        node = parent;
                    }
                    if (node != null && node != focused) node.recycle();
                    return;
                }
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
                    try {
                        // Some Android TV apps expose accessibility focus but
                        // not standard input focus. Both are best-effort only.
                        if (!next.performAction(AccessibilityNodeInfo.ACTION_FOCUS))
                            next.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS);
                    } finally { next.recycle(); }
                } else {
                    // When the card is at a list boundary, permit scrolling
                    // through the nearest scrollable ancestor.
                    AccessibilityNodeInfo node = focused.getParent();
                    for (int level = 0; level < 6 && node != null; level++) {
                        if (node.isScrollable()) {
                            boolean forward = direction == View.FOCUS_DOWN || direction == View.FOCUS_RIGHT;
                            if (node.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD :
                                AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) { node.recycle(); node = null; break; }
                        }
                        AccessibilityNodeInfo parent = node.getParent();
                        node.recycle();
                        node = parent;
                    }
                    if (node != null) node.recycle();
                }
            } finally { focused.recycle(); }
        } finally { root.recycle(); }
    }
}
