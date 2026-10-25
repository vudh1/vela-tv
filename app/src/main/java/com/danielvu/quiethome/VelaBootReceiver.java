package com.danielvu.quiethome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Mark only a real Android TV reboot for profile selection.
 * Ordinary streaming-app navigation never sends BOOT_COMPLETED.
 */
public final class VelaBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent != null && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            context.getSharedPreferences("quiet-home", Context.MODE_PRIVATE).edit()
                .putBoolean("profile_choose_on_next_home", true).apply();
        }
    }
}
