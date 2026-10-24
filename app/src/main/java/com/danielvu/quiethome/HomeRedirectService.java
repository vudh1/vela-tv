package com.danielvu.quiethome;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/** Optional, explicitly user-enabled launcher override for OEMs that ignore HOME role.
 *  Watches only launcher activity transitions. Never reads screen contents, text, or keys.
 */
public final class HomeRedirectService extends AccessibilityService {
    private static final String TAG = "VelaRedirect";
    private long lastRedirect;
    private boolean velaSeenBetween;
    private long snoozeUntil;
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (!getSharedPreferences("quiet-home", MODE_PRIVATE).getBoolean("redirect_home", false)) return;
        CharSequence pkgName=event.getPackageName();
        CharSequence clsName=event.getClassName();
        if (pkgName==null || clsName==null) return;
        String pkg=pkgName.toString(), cls=clsName.toString();
        // Service metadata now includes Vela too, solely to disambiguate repeated launcher openings.
        if(getPackageName().equals(pkg)){
            if(cls.endsWith("MainActivity")&&lastRedirect>0)velaSeenBetween=true;
            return;
        }
        if (!"com.google.android.apps.tv.launcherx".equals(pkg)
            || !"com.google.android.apps.tv.launcherx.home.HomeActivity".equals(cls)) return;
        long now=SystemClock.elapsedRealtime();
        if(now<snoozeUntil) return;
        // Experimental: two real HOME opens separated by Vela foregrounding.
        // Never interpret duplicate events from a single Home press as a double press.
        if(velaSeenBetween&&now-lastRedirect>=240&&now-lastRedirect<=1250){
            snoozeUntil=now+5000;velaSeenBetween=false;lastRedirect=0;
            // Google Home is already foreground. Leave it visible for this session.
            return;
        }
        if(now-lastRedirect<350) return;
        lastRedirect=now;velaSeenBetween=false;
        try {
            Intent start=new Intent(this, MainActivity.class);
            start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            startActivity(start);
        } catch (RuntimeException exception) {
            Log.w(TAG,"Redirect rejected by device firmware",exception);
        }
    }
    @Override public void onInterrupt() { }
}
