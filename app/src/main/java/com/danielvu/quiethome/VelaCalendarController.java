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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Each profile has two encrypted read-only iCalendar subscriptions (Google + BallerWatch).
 * Calendar fetch/parse never occurs on the TV UI or WebView JavaScript thread.
 * URLs stay in the Android Keystore-protected native storage, never in JavaScript or logs.
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
    private static String sourceOf(String url){
        try{return "ballerwatch-web.vudhone.workers.dev".equalsIgnoreCase(Uri.parse(url).getHost())?"sport":"google";}
        catch(Exception ignored){return "google";}
    }
    private String sourceUrl(String profile,String source){
        String direct=decrypt(prefs.getString(source+"_url_"+profile,""));
        if(!direct.isEmpty())return direct;
        String legacy=decrypt(prefs.getString("url_"+profile,""));
        return !legacy.isEmpty()&&source.equals(sourceOf(legacy))?legacy:"";
    }
    private JSONArray cachedSource(String profile,String source,String today){
        if(!today.equals(prefs.getString("day_"+source+"_"+profile,"")) ||
           prefs.getLong("success_"+source+"_"+profile,0)<=0)return new JSONArray();
        try{return new JSONArray(decrypt(prefs.getString("cache_"+source+"_"+profile,"")));}
        catch(Exception ignored){return new JSONArray();}
    }
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
    private static boolean allowedCalendarUrl(String url){
        try {
            if(url==null||url.length()>4096)return false;
            Uri u=Uri.parse(url.trim());
            if(!"https".equalsIgnoreCase(u.getScheme())||u.getPort()!=-1
               ||u.getUserInfo()!=null||u.getFragment()!=null)return false;
            String host=u.getHost(),path=u.getEncodedPath();
            if(host==null||path==null)return false;
            boolean google="calendar.google.com".equalsIgnoreCase(host)
                &&path.startsWith("/calendar/ical/")&&path.endsWith(".ics");
            boolean ballerwatch="ballerwatch-web.vudhone.workers.dev".equalsIgnoreCase(host)
                &&path.equals("/web/calendar.ics");
            if(ballerwatch)for(String key:u.getQueryParameterNames())
                if(!key.equals("teams")&&!key.equals("pickup")&&!key.equals("watch"))return false;
            return google||ballerwatch;
        }catch(Exception ignored){return false;}
    }
    private String download(String url) throws Exception {
        // Never follow a redirect to an unapproved host or feed path.
        for(int redirect=0;redirect<4;redirect++){
            if(!allowedCalendarUrl(url))throw new IllegalArgumentException("Use an approved Google or BallerWatch iCalendar address");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept","text/calendar,text/plain");connection.setRequestProperty("Accept-Encoding","identity");
            try{
                int status=connection.getResponseCode();
                if(status>=300&&status<400){String target=connection.getHeaderField("Location");if(target==null)throw new IllegalStateException("Redirect without location");url=new URL(new URL(url),target).toString();continue;}
                if(status!=200)throw new IllegalStateException("Calendar source returned HTTP "+status);
                try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buf=new byte[8192];int n,total=0;
                    while((n=in.read(buf))!=-1){total+=n;if(total>2_000_000)throw new IllegalStateException("Calendar feed is too large");out.write(buf,0,n);}
                    return new String(out.toByteArray(),StandardCharsets.UTF_8);
                }
            }finally{connection.disconnect();}
        }
        throw new IllegalStateException("Too many calendar redirects");
    }
    static boolean isValidCalendarLink(String url){return allowedCalendarUrl(url);}
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
            o.put("verified",connected&&success>0&&LocalDate.now(ZoneId.systemDefault()).toString().equals(prefs.getString("day_"+p,"")));
            o.put("lastSuccess",success);o.put("lastAttempt",prefs.getLong("attempt_"+p,0));
            o.put("label",decrypt(prefs.getString("label_"+p,"")));
            o.put("calendarName",decrypt(prefs.getString("name_"+p,"")));
            o.put("calendarId",calendarIdentifier(sourceUrl(p,"google")));
            JSONArray sources=new JSONArray();
            for(String source:new String[]{"google","sport"})if(!sourceUrl(p,source).isEmpty()){
                JSONObject s=new JSONObject();s.put("kind",source);s.put("verified",
                    prefs.getLong("success_"+source+"_"+p,0)>0&&
                    LocalDate.now(ZoneId.systemDefault()).toString().equals(prefs.getString("day_"+source+"_"+p,"")));
                sources.put(s);
            }
            o.put("sources",sources);
            activity.deliverCalendar(o.toString());
        }catch(Exception ignored){}
    }
    void saveLink(String profile,String url,String label){
        if(!profileOkay(profile)||"guest".equals(profile)||!allowedCalendarUrl(url))return;
        worker.execute(()->{
            try{
                String source=sourceOf(url);
                SharedPreferences.Editor e=prefs.edit().putString(source+"_url_"+profile,encrypt(url))
                    .putString("label_"+profile,encrypt(label==null?"":label.trim().substring(0,Math.min(80,label.trim().length()))))
                    .remove("data_"+profile).remove("checked_"+profile).remove("success_"+profile)
                    .remove("day_"+profile).remove("cache_"+source+"_"+profile)
                    .remove("success_"+source+"_"+profile).remove("day_"+source+"_"+profile);
                String legacy=decrypt(prefs.getString("url_"+profile,""));
                if(source.equals(sourceOf(legacy)))e.remove("url_"+profile);
                e.apply();
                load(profile,true);
            }catch(Exception e){activity.showCalendarError("Could not securely save calendar link");}
        });
    }
    void editSource(String profile,String source){
        if(!profileOkay(profile)||"guest".equals(profile)||(!"google".equals(source)&&!"sport".equals(source)))return;
        activity.runOnUiThread(()->{
            EditText input=new EditText(activity);input.setSingleLine(true);
            input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
            input.setHint("sport".equals(source)?"https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics":"https://calendar.google.com/calendar/ical/.../basic.ics");
            new AlertDialog.Builder(activity).setTitle("sport".equals(source)?"Connect BallerWatch sports":"Connect private Google calendar")
                .setMessage("Paste the read-only iCal subscription URL. This profile can keep both sources.")
                .setView(input).setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Save",(d,w)->{
                    String url=input.getText().toString().trim();
                    if(!allowedCalendarUrl(url)||!source.equals(sourceOf(url))){activity.showCalendarError("Use the selected source's HTTPS iCal link");return;}
                    saveLink(profile,url,"sport".equals(source)?"BallerWatch":"Google Calendar");
                }).show();
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
            boolean connected=!sourceUrl(profile,"google").isEmpty()||!sourceUrl(profile,"sport").isEmpty();
            String cache=decrypt(prefs.getString("data_"+profile,""));if(cache.isEmpty())cache="[]";
            if(!connected){deliver(profile,false,"[]","No calendar saved");return;}
            long last=prefs.getLong("checked_"+profile,0);
            if(!force&&System.currentTimeMillis()-last<TTL&&LocalDate.now(ZoneId.systemDefault()).toString().equals(prefs.getString("day_"+profile,""))){deliver(profile,true,cache,prefs.getLong("success_"+profile,0)>0?"Verified feed · cached, refreshes every 15 minutes":"Link saved · not yet verified");return;}
            // Return cached events immediately so opening the calendar is never network-blocking.
            deliver(profile,true,cache,"Checking calendar feed…");
            prefs.edit().putLong("attempt_"+profile,System.currentTimeMillis()).apply();
            try{
                ZoneId zone=ZoneId.systemDefault();LocalDate day=LocalDate.now(zone);
                List<JSONObject> combined=new ArrayList<>();Set<String> ids=new HashSet<>();
                int refreshed=0,total=0;String displayName="";
                for(String source:new String[]{"google","sport"}){
                    String url=sourceUrl(profile,source);if(url.isEmpty())continue;total++;
                    JSONArray list=cachedSource(profile,source,day.toString());
                    try{
                        String feed=download(url);if(!validCalendarFeed(feed))throw new IllegalStateException("Invalid iCal feed");
                        // Keep future source data beyond the one-month TV list;
                        // Home and screensaver still select only timely events.
                        List<CalendarIcs.Event> events=CalendarIcs.upcoming(feed,zone,day,120);
                        JSONArray fresh=new JSONArray();for(CalendarIcs.Event e:events){
                            JSONObject j=new JSONObject();j.put("title",e.title);j.put("start",e.start).put("end",e.end).put("allDay",e.allDay)
                                .put("uid",e.uid).put("kind",e.kind).put("location",e.location).put("description",e.description)
                                .put("channel",e.channel).put("url",e.url);fresh.put(j);
                        }
                        list=fresh;long now=System.currentTimeMillis();
                        prefs.edit().putString("cache_"+source+"_"+profile,encrypt(list.toString()))
                            .putLong("success_"+source+"_"+profile,now).putString("day_"+source+"_"+profile,day.toString()).apply();
                        refreshed++;
                        displayName+=displayName.isEmpty()?calendarName(feed):" + "+(source.equals("sport")?"BallerWatch":"Google");
                    }catch(Exception e){
                        android.util.Log.w("VelaCalendar","Source refresh failed: "+e.getClass().getSimpleName());
                    }
                    for(int i=0;i<list.length();i++){
                        JSONObject obj=list.optJSONObject(i);if(obj==null)continue;
                        String id=obj.optString("uid","")+"/"+obj.optLong("start");
                        if(ids.add(id))combined.add(obj);
                    }
                }
                combined.sort((a,b)->Long.compare(a.optLong("start"),b.optLong("start")));
                JSONArray array=new JSONArray();for(int i=0;i<Math.min(150,combined.size());i++)array.put(combined.get(i));
                String data=array.toString();SharedPreferences.Editor e=prefs.edit()
                    .putString("data_"+profile,encrypt(data)).putLong("checked_"+profile,System.currentTimeMillis())
                    .putString("day_"+profile,day.toString());
                if(refreshed>0)e.putLong("success_"+profile,System.currentTimeMillis());
                if(!displayName.isEmpty())e.putString("name_"+profile,encrypt(displayName));
                e.apply();
                deliver(profile,true,data,refreshed==total?(array.length()==0?"Verified · no upcoming events":"Verified · updated just now"):
                    refreshed>0?"Some sources failed · showing their last saved events":"Refresh failed · showing saved calendar events");
            }catch(Exception e){android.util.Log.w("VelaCalendar","Calendar refresh failed (no URL logged): "+e.getClass().getSimpleName());deliver(profile,true,cache,prefs.getLong("success_"+profile,0)>0?"Last refresh failed · showing verified cache":"Link saved, but calendar source has not returned a valid feed");}
        });
    }
    void edit(String profile){
        if(!profileOkay(profile)||"guest".equals(profile))return;
        activity.runOnUiThread(()->{
            EditText input=new EditText(activity);input.setSingleLine(true);input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
            input.setHint("https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics");
            new AlertDialog.Builder(activity).setTitle("Connect calendar · read-only")
                .setMessage("Paste a Google Calendar secret iCal address or the calendar subscription URL copied from BallerWatch → Settings → Share my calendar. Both are read-only; use trusted Wi-Fi.")
                .setView(input).setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Save",(d,w)->{
                    String url=input.getText().toString().trim();if(!allowedCalendarUrl(url)){
                        new AlertDialog.Builder(activity).setTitle("Invalid calendar address").setMessage("Only official Google Calendar secret .ics URLs and BallerWatch /web/calendar.ics URLs are supported. Use Copy calendar link in BallerWatch settings.").setPositiveButton("OK",null).show();return;}
                    saveLink(profile,url,"");
                }).show();
        });
    }
    void removeSource(String profile,String source){
        if(!profileOkay(profile)||(!"google".equals(source)&&!"sport".equals(source)))return;
        worker.execute(()->{
            SharedPreferences.Editor e=prefs.edit().remove(source+"_url_"+profile)
                .remove("cache_"+source+"_"+profile).remove("success_"+source+"_"+profile)
                .remove("day_"+source+"_"+profile).remove("data_"+profile)
                .remove("checked_"+profile).remove("day_"+profile).remove("success_"+profile);
            String legacy=decrypt(prefs.getString("url_"+profile,""));
            if(!legacy.isEmpty()&&source.equals(sourceOf(legacy)))e.remove("url_"+profile);
            e.apply();load(profile,true);
        });
    }
    void remove(String profile){if(!profileOkay(profile))return;
        worker.execute(()->{SharedPreferences.Editor e=prefs.edit();
            for(String source:new String[]{"google","sport"})e.remove(source+"_url_"+profile)
                .remove("cache_"+source+"_"+profile).remove("success_"+source+"_"+profile)
                .remove("day_"+source+"_"+profile);
            e.remove("url_"+profile).remove("data_"+profile).remove("checked_"+profile)
                .remove("day_"+profile).remove("success_"+profile).remove("attempt_"+profile)
                .remove("label_"+profile).remove("name_"+profile).apply();deliver(profile,false,"[]","Disconnected");});
    }
}
