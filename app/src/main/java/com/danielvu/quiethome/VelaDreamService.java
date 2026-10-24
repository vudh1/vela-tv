package com.danielvu.quiethome;

import android.service.dreams.DreamService;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.text.format.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Optional native clock screensaver; user selects it from system settings. */
public final class VelaDreamService extends DreamService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private TextView time;
    private TextView date;
    private int step = 0;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (time == null || date == null || root == null) return;
            Date now = new Date();
            time.setText(DateFormat.getTimeFormat(VelaDreamService.this).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(now));
            // Four safe locations; dim gray and frequent position changes prevent static UI burn-in.
            final int[] x = { 12, 70, 60, 20 };
            final int[] y = { 17, 23, 73, 67 };
            int width = root.getWidth(), height = root.getHeight();
            if (width > 0 && height > 0) {
                time.setTranslationX((width - time.getWidth()) * x[step % 4] / 100f);
                time.setTranslationY((height - time.getHeight()) * y[step % 4] / 100f);
                date.setTranslationX(time.getTranslationX());
                date.setTranslationY(time.getTranslationY() + time.getHeight() + 10);
            }
            step++;
            handler.postDelayed(this, 60000);
        }
    };
    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        setScreenBright(false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        time = new TextView(this);
        time.setTextSize(54f);
        time.setTextColor(Color.rgb(140, 146, 148));
        time.setGravity(Gravity.CENTER);
        date = new TextView(this);
        date.setTextSize(17f);
        date.setTextColor(Color.rgb(100, 105, 106));
        root.addView(time, new FrameLayout.LayoutParams(-2, -2));
        root.addView(date, new FrameLayout.LayoutParams(-2, -2));
        setContentView(root);
        root.post(ticker);
    }
    @Override public void onDetachedFromWindow() {
        handler.removeCallbacks(ticker);
        root = null;time = null;date = null;
        super.onDetachedFromWindow();
    }
}
