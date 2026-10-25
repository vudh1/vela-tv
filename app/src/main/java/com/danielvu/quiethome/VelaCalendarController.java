package com.danielvu.quiethome;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.widget.EditText;
import android.text.InputType;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Each profile has a private, encrypted, read-only Google Calendar iCal subscription.
 * Calendar fetch/parse never occurs on the TV UI or WebView JavaScript thread.
 * The URL is never sent to JavaScript, telemetry, GitHub, or the network except Google Calendar.
 */
final class VelaCalendarController {
    private final MainActivity activity;
    private final SharedPreferences prefs;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static final String ALIAS="VelaCalendarSubscriptions_v1";
    private static final long TTL=15*60*1000L;
    VelaCalendarController(MainActivity a){
        activity=a;prefs=a.getSharedPreferences("vela-calendar-private",Context.MODE_PRIVATE);
        // Purge Guest data saved by older versions: Guest never stores calendar secrets.
        prefs.edit().remove("url_guest").remove("data_guest").remove("label_guest").remove("name_guest")
            .remove("checked_guest").remove("day_guest").remove("success_guest").remove("attempt_guest").apply();
    }
    void shutdown(){worker.shutdownNow();}
    private static boolean profileOkay(String p){return p!=null&&p.matches("[a-zA-Z0-9_-]{1,48}");}
    private static SecretKey getKey() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(ks.containsAlias(ALIAS))return ((KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey();
        KeyGenerator k=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        k.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());return k.generateKey();
    }
    private String encrypt(String s) throws Exception {
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,getKey());
        byte[] b=c.doFinal(s.getBytes(StandardCharsets.UTF_8));byte[] iv=c.getIV();byte[] combined=new byte[iv.length+b.length];
        System.arraycopy(iv,0,combined,0,iv.length);System.arraycopy(b,0,combined,iv.length,b.length);
        return Base64.encodeToString(combined,Base64.NO_WRAP);
    }
    private static String decrypt(String text) {
        if(text==null||text.isEmpty())return "";
        try{byte[] b=Base64.decode(text,Base64.DEFAULT);if(b.length<29)return "";
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,getKey(),new GCMParameterSpec(128,b,0,12));
            return new String(c.doFinal(b,12,b.length-12),StandardCharsets.UTF_8);
        }catch(Exception ignored){return "";}
    }
    /** Snapshot ONLY verified, today's encrypted cached events for the native DreamService.
     * Never fetch or reveal private URLs in a dream, and fail closed on stale cache. */
    static JSONArray cachedEventsForDream(Context ctx, String profile) {
        JSONArray empty = new JSONArray();
        if (!profileOkay(profile) || "guest".equals(profile)) return empty;
        try {
            SharedPreferences p = ctx.getSharedPreferences("vela-calendar-private", Context.MODE_PRIVATE);
            if (p.getLong("success_"+profile, 0L) <= 0L ||
                !LocalDate.now(ZoneId.systemDefault()).toString().equals(p.getString("day_"+profile,""))) return empty;
            String data = decrypt(p.getString("data_"+profile,""));
            if (data.isEmpty()) return empty;
            return new JSONArray(data);
        } catch(Exception ignored) { return empty; }
    }
    private static boolean googleCalendarUrl(String url){
        try{Uri u=Uri.parse(url.trim());return "https".equalsIgnoreCase(u.getScheme())&&"calendar.google.com".equalsIgnoreCase(u.getHost())
            &&u.getPort()==-1&&u.getEncodedPath()!=null&&u.getEncodedPath().startsWith("/calendar/ical/")&&u.getEncodedPath().endsWith(".ics")&&url.length()<=4096
            &&u.getUserInfo()==null;}
        catch(Exception ignored){return false;}
    }
    private String download(String url) throws Exception {
        // Never follow a redirect outside the same trusted Google Calendar host.
        for(int redirect=0;redirect<4;redirect++){
            if(!googleCalendarUrl(url))throw new IllegalArgumentException("Calendar URL must be a private Google iCal address");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept","text/calendar,text/plain");connection.setRequestProperty("Accept-Encoding","identity");
            try{
                int status=connection.getResponseCode();
                if(status>=300&&status<400){String target=connection.getHeaderField("Location");if(target==null)throw new IllegalStateException("Redirect without location");url=new URL(new URL(url),target).toString();continue;}
                if(status!=200)throw new IllegalStateException("Google Calendar returned HTTP "+status);
                try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buf=new byte[8192];int n,total=0;
                    while((n=in.read(buf))!=-1){total+=n;if(total>2_000_000)throw new IllegalStateException("Calendar feed is too large");out.write(buf,0,n);}
                    return new String(out.toByteArray(),StandardCharsets.UTF_8);
                }
            }finally{connection.disconnect();}
        }
        throw new IllegalStateException("Too many calendar redirects");
    }
    static boolean isValidGoogleCalendarLink(String url){return googleCalendarUrl(url);}
    private static String calendarName(String ics){
        for(String line:ics.replace("\r\n", "\n").split("\n")) {
            if(line.startsWith("X-WR-CALNAME:")) return line.substring(13).trim().replace("\\,",",").replace("\\;",";");
        }
        return "";
    }
    private void deliver(String p,boolean connected,String json,String status){
        try{
            JSONObject o=new JSONObject();o.put("profile",p);o.put("connected",connected);o.put("events",new JSONArray(json));o.put("status",status);
            long success=prefs.getLong("success_"+p,0);
            o.put("verified",connected&&success>0);
            o.put("lastSuccess",success);o.put("lastAttempt",prefs.getLong("attempt_"+p,0));
            o.put("label",decrypt(prefs.getString("label_"+p,"")));
            o.put("calendarName",decrypt(prefs.getString("name_"+p,"")));
            o.put("calendarId",calendarIdentifier(decrypt(prefs.getString("url_"+p,""))));
            activity.deliverCalendar(o.toString());
        }catch(Exception ignored){}
    }
    void saveLink(String profile,String url,String label){
        if(!profileOkay(profile)||"guest".equals(profile)||!googleCalendarUrl(url))return;
        worker.execute(()->{
            try{
                prefs.edit().putString("url_"+profile,encrypt(url)).putString("label_"+profile,encrypt(label==null?"":label.trim().substring(0,Math.min(80,label.trim().length()))))
                    .remove("data_"+profile).remove("checked_"+profile).remove("success_"+profile).remove("attempt_"+profile).remove("day_"+profile).remove("name_"+profile).apply();
                load(profile,true);
            }catch(Exception e){activity.showCalendarError("Could not securely save calendar link");}
        });
    }
    private static boolean validCalendarFeed(String s){return s!=null&&s.trim().startsWith("BEGIN:VCALENDAR")&&s.contains("END:VCALENDAR");}
    private static String calendarIdentifier(String url){
        try{
            Uri u=Uri.parse(url);java.util.List<String> segments=u.getPathSegments();
            if(segments.size()>=4&&"calendar".equals(segments.get(0))&&"ical".equals(segments.get(1))){
                String id=segments.get(2);
                return id.contains("@")?id:""; // May also be a group calendar ID, not a signed-in account.
            }
        }catch(Exception ignored){}
        return "";
    }

    void load(String profile,boolean force){
        if(!profileOkay(profile))return;
        if("guest".equals(profile)){deliver(profile,false,"[]","Guest is temporary; calendars are not saved");return;}
        worker.execute(()->{
            String url=decrypt(prefs.getString("url_"+profile,""));boolean connected=!url.isEmpty();
            String cache=decrypt(prefs.getString("data_"+profile,""));if(cache.isEmpty())cache="[]";
            if(!connected){deliver(profile,false,"[]","No calendar saved");return;}
            long last=prefs.getLong("checked_"+profile,0);
            if(!force&&System.currentTimeMillis()-last<TTL&&LocalDate.now(ZoneId.systemDefault()).toString().equals(prefs.getString("day_"+profile,""))){deliver(profile,true,cache,prefs.getLong("success_"+profile,0)>0?"Verified feed · cached, refreshes every 15 minutes":"Link saved · not yet verified");return;}
            // Return cached events immediately so opening the calendar is never network-blocking.
            deliver(profile,true,cache,"Checking Google Calendar…");
            prefs.edit().putLong("attempt_"+profile,System.currentTimeMillis()).apply();
            try{
                ZoneId zone=ZoneId.systemDefault();LocalDate day=LocalDate.now(zone);
                String feed=download(url);
                if(!validCalendarFeed(feed))throw new IllegalStateException("Invalid iCal response");
                List<CalendarIcs.Event> events=CalendarIcs.today(feed,zone,day);
                JSONArray array=new JSONArray();for(CalendarIcs.Event e:events){JSONObject j=new JSONObject();j.put("title",e.title);j.put("start",e.start);j.put("end",e.end);j.put("allDay",e.allDay);array.put(j);}
                String data=array.toString();prefs.edit().putString("data_"+profile,encrypt(data)).putLong("checked_"+profile,System.currentTimeMillis())
                    .putLong("success_"+profile,System.currentTimeMillis()).putString("name_"+profile,encrypt(calendarName(feed)))
                    .putString("day_"+profile,day.toString()).apply();
                deliver(profile,true,data,events.isEmpty()?"Verified with Google · no events today":"Verified with Google · updated just now");
            }catch(Exception e){android.util.Log.w("VelaCalendar","Calendar refresh failed (no URL logged): "+e.getClass().getSimpleName());deliver(profile,true,cache,prefs.getLong("success_"+profile,0)>0?"Last refresh failed · showing verified cache":"Link saved, but Google has not returned a valid feed");}
        });
    }
    void edit(String profile){
        if(!profileOkay(profile)||"guest".equals(profile))return;
        activity.runOnUiThread(()->{
            EditText input=new EditText(activity);input.setSingleLine(true);input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
            input.setHint("https://calendar.google.com/calendar/ical/…/basic.ics");
            new AlertDialog.Builder(activity).setTitle("Connect Google Calendar · read-only")
                .setMessage("On a computer: Google Calendar → Settings → your calendar → Integrate calendar → Secret address in iCal format. Paste it here. This link is private: never share it.")
                .setView(input).setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Save",(d,w)->{
                    String url=input.getText().toString().trim();if(!googleCalendarUrl(url)){
                        new AlertDialog.Builder(activity).setTitle("Invalid calendar address").setMessage("Use the Secret address in iCal format from Google Calendar. The URL must begin https://calendar.google.com/calendar/ical/ and end with .ics.").setPositiveButton("OK",null).show();return;}
                    saveLink(profile,url,"");
                }).show();
        });
    }
    void remove(String profile){if(!profileOkay(profile))return;
        worker.execute(()->{prefs.edit().remove("url_"+profile).remove("data_"+profile).remove("checked_"+profile).remove("day_"+profile).remove("success_"+profile).remove("attempt_"+profile).remove("label_"+profile).remove("name_"+profile).apply();deliver(profile,false,"[]","Disconnected");});
    }
}
