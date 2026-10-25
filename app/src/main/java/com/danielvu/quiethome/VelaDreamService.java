package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.service.dreams.DreamService;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;

/** Native, local-only scenic screensaver with a softly moving clock.
 * Uses verified, encrypted cached calendar data: no network work while dreaming.
 */
public final class VelaDreamService extends DreamService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private LinearLayout clockGroup, eventBlock;
    private ImageView scenery;
    private TextView time, date;

    private String currentProfile() {
        SharedPreferences pref = getSharedPreferences("quiet-home", Context.MODE_PRIVATE);
        return pref.getString("ui_active_profile_v2", "duong");
    }
    private String chooseWallpaper() {
        String[] images = { "mist-lake", "blue-coast", "amber-dunes", "lavender-bay" };
        try {
            SharedPreferences prefs = getSharedPreferences("quiet-home", Context.MODE_PRIVATE);
            String active = currentProfile();
            JSONObject saved = new JSONObject(prefs.getString("ui_profile_data_v2", "{}"));
            JSONArray profiles = saved.optJSONArray("profiles");
            if (profiles != null) for (int i = 0; i < profiles.length(); i++) {
                JSONObject p = profiles.optJSONObject(i);
                if (p != null && active.equals(p.optString("id"))) {
                    int selected = Integer.parseInt(p.optString("scenery", "4"));
                    return "wallpapers/" + images[Math.floorMod(selected - 4, images.length)] + ".webp";
                }
            }
        } catch (Exception ignored) {}
        return "wallpapers/mist-lake.webp";
    }

    private TextView text(String value,int size,int color) {
        TextView view = new TextView(this);
        view.setText(value);view.setTextSize(size);view.setTextColor(color);
        view.setGravity(Gravity.CENTER);view.setMaxLines(1);
        view.setEllipsize(android.text.TextUtils.TruncateAt.END);
        return view;
    }

    /** Maximum three current/upcoming events, prioritized by status and start time. */
    private void refreshEvents() {
        if(eventBlock == null)return;
        eventBlock.removeAllViews();
        JSONArray data=VelaCalendarController.cachedEventsForDream(this,currentProfile());
        long now=System.currentTimeMillis();
        ArrayList<JSONObject> events=new ArrayList<>();
        for(int i=0;i<data.length();i++){
            JSONObject e=data.optJSONObject(i);
            if(e == null)continue;
            long start=e.optLong("start"),end=e.optLong("end");
            if(start<=0||end<=now||start>now+2*3600000L)continue;
            events.add(e);
        }
        Collections.sort(events,(a,b)->{
            boolean aNow=a.optLong("start")<=now,bNow=b.optLong("start")<=now;
            if(aNow!=bNow)return aNow?-1:1;
            return Long.compare(a.optLong("start"),b.optLong("start"));
        });
        if(events.isEmpty())return;
        TextView heading=text("TODAY · "+(events.size()>3?"NEXT 3 EVENTS":"UPCOMING"),12,Color.rgb(210,231,221));
        heading.setLetterSpacing(.12f);eventBlock.addView(heading);
        for(int i=0;i<Math.min(3,events.size());i++){
            JSONObject e=events.get(i);
            boolean nowOn=e.optLong("start")<=now;
            long delta=e.optLong("start")-now;
            String when=nowOn?"NOW":delta<=3600000L?"IN "+Math.max(1,(delta+59999)/60000)+" MIN":
                DateFormat.getTimeFormat(this).format(new Date(e.optLong("start")));
            String label=e.optString("title","Event").replace('\n',' ');
            if(label.length()>65)label=label.substring(0,65)+"…";
            TextView line=text(when+"  ·  "+label,15,nowOn?Color.rgb(247,224,175):Color.rgb(235,245,238));
            line.setPadding(12,6,12,4);
            eventBlock.addView(line,new LinearLayout.LayoutParams(-1,-2));
        }
    }
    /** Reposition the whole clock+event composition inside a safe center region. */
    private void positionContent() {
        if(root==null||clockGroup==null)return;
        root.post(()->{
            if(root==null||clockGroup==null)return;
            int horizontal=Math.max(0,(root.getWidth()-clockGroup.getWidth())/2-48);
            int vertical=Math.max(0,(root.getHeight()-clockGroup.getHeight())/2-50);
            // Deliberately shallow drift, not extreme corners, to preserve legibility.
            int step=(int)((System.currentTimeMillis()/300000L)%4);
            float[] xs={-.60f,.52f,.38f,-.40f};
            float[] ys={-.32f,-.23f,.35f,.31f};
            clockGroup.setTranslationX(horizontal*xs[step]);
            clockGroup.setTranslationY(vertical*ys[step]);
        });
    }
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if(root==null||time==null)return;
            Date now=new Date();
            time.setText(DateFormat.getTimeFormat(VelaDreamService.this).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d",Locale.getDefault()).format(now));
            refreshEvents();
            positionContent();
            handler.postDelayed(this, 60000L - (System.currentTimeMillis() % 60000L) + 60L);
        }
    };

    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);setFullscreen(true);setScreenBright(true);
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(19,38,43));
        scenery=new ImageView(this);scenery.setScaleType(ImageView.ScaleType.CENTER_CROP);
        scenery.setAlpha(.57f);
        try(InputStream in=getAssets().open(chooseWallpaper())){
            BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=2;
            Bitmap bitmap=BitmapFactory.decodeStream(in,null,options);
            if(bitmap!=null)scenery.setImageBitmap(bitmap);
        }catch(Exception ignored){}
        root.addView(scenery,new FrameLayout.LayoutParams(-1,-1));
        FrameLayout veil=new FrameLayout(this);
        veil.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.argb(90,5,20,26),Color.argb(150,5,15,20)}));
        root.addView(veil,new FrameLayout.LayoutParams(-1,-1));
        clockGroup=new LinearLayout(this);clockGroup.setOrientation(LinearLayout.VERTICAL);
        clockGroup.setGravity(Gravity.CENTER);
        time=text(DateFormat.getTimeFormat(this).format(new Date()),68,Color.rgb(236,246,240));
        date=text(new SimpleDateFormat("EEEE, MMMM d",Locale.getDefault()).format(new Date()),20,Color.rgb(201,222,217));
        clockGroup.addView(time,new LinearLayout.LayoutParams(-2,-2));
        clockGroup.addView(date,new LinearLayout.LayoutParams(-2,-2));
        eventBlock=new LinearLayout(this);eventBlock.setGravity(Gravity.CENTER);
        eventBlock.setOrientation(LinearLayout.VERTICAL);eventBlock.setPadding(16,22,16,0);
        clockGroup.addView(eventBlock,new LinearLayout.LayoutParams(-2,-2));
        root.addView(clockGroup,new FrameLayout.LayoutParams(-2,-2,Gravity.CENTER));
        setContentView(root);refreshEvents();
    }
    @Override public void onDreamingStarted(){super.onDreamingStarted();handler.removeCallbacks(ticker);ticker.run();}
    @Override public void onDreamingStopped(){handler.removeCallbacks(ticker);super.onDreamingStopped();}
    @Override public void onDetachedFromWindow(){
        handler.removeCallbacks(ticker);
        if(scenery!=null)scenery.setImageDrawable(null);
        scenery=null;clockGroup=null;root=null;time=null;date=null;eventBlock=null;
        super.onDetachedFromWindow();
    }
}
