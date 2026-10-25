package com.danielvu.quiethome;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Bundle;
import android.util.Log;

/** Non-exported Android installer callback: never trust an outside app to launch intents. */
public final class VelaInstallResultActivity extends Activity {
    static final String ACTION_STATUS = "com.danielvu.quiethome.UPDATE_INSTALL_STATUS";
    static final String RESULT_KEY = "update_install_result";

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (ACTION_STATUS.equals(getIntent() == null ? null : getIntent().getAction()))
            handle(getIntent());
        finish();
    }

    private void record(String result) {
        SharedPreferences prefs = getSharedPreferences("quiet-home", MODE_PRIVATE);
        prefs.edit().putString(RESULT_KEY, result).apply();
    }

    @SuppressWarnings("deprecation")
    private void handle(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent approval = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (approval == null) {
                record("Android did not provide an installation confirmation screen. Use manual APK installation.");
                return;
            }
            try {
                approval.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(approval);
                record("Waiting for your approval in the Android installer…");
            } catch (RuntimeException error) {
                Log.w("VelaUpdate", "Android install confirmation unavailable", error);
                record("Android could not open its installation confirmation. Use manual APK installation.");
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            record("Vela update installed successfully");
        } else if (status == PackageInstaller.STATUS_FAILURE_BLOCKED) {
            record("Android blocked installation. Check the Sony TV install policy or install the signed APK manually.");
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            record("Installation cancelled; the downloaded update is still available");
        } else if (status == PackageInstaller.STATUS_FAILURE_CONFLICT) {
            record("Android rejected the update because its package or signing certificate conflicts with the installed app");
        } else if (status == PackageInstaller.STATUS_FAILURE_STORAGE) {
            record("Not enough TV storage for the update. Free space and retry.");
        } else {
            Log.w("VelaUpdate", "Android installation returned status " + status);
            record("Android did not install the update (code " + status + "). Try the signed APK manually.");
        }
    }
}
