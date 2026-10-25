package com.danielvu.quiethome;

import android.net.Uri;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;

/** Optional, three-minute, single-use LAN setup for calendar subscriptions.
 * IMPORTANT: This is local HTTP, not TLS. Use only on trusted private Wi-Fi.
 * The QR contains only the TV's local pairing address and a random token,
 * never the private iCal URL. No URLs are written to logs.
 */
final class VelaPairingServer {
    private static final long LIFE_MS=10*60*1000L;
    private final MainActivity activity;
    private final VelaCalendarController calendar;
    private volatile ServerSocket socket;
    private volatile long expires;
    private volatile String token="";
    private volatile String profile="";
    private volatile String host="";
    private volatile int attempts=0;
    private volatile boolean saved=false;
    private final SecureRandom random=new SecureRandom();
    VelaPairingServer(MainActivity a,VelaCalendarController c){activity=a;calendar=c;}
    synchronized void stop(){try{if(socket!=null)socket.close();}catch(Exception ignored){}socket=null;token="";}
    synchronized long expiresAt(){return expires;}
    private static String localIp(){
        try{
            Enumeration<NetworkInterface> it=NetworkInterface.getNetworkInterfaces();
            while(it.hasMoreElements()){
                NetworkInterface n=it.nextElement();if(!n.isUp()||n.isLoopback())continue;
                Enumeration<InetAddress> list=n.getInetAddresses();
                while(list.hasMoreElements()){
                    InetAddress a=list.nextElement();if(!(a instanceof Inet4Address)||a.isLoopbackAddress()||a.isLinkLocalAddress())continue;
                    String ip=a.getHostAddress();
                    if(ip.startsWith("192.168.")||ip.startsWith("10.")||ip.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..*"))return ip;
                }
            }
        }catch(Exception ignored){}
        return "";
    }
    synchronized String start(String p) throws IOException{
        stop();if("guest".equals(p)||!p.matches("[A-Za-z0-9_-]{1,48}"))throw new IOException("Select a saved profile");
        String ip=localIp();if(ip.isEmpty())throw new IOException("TV is not on a private Wi-Fi or LAN");
        byte[] bytes=new byte[20];random.nextBytes(bytes);StringBuilder sb=new StringBuilder();for(byte b:bytes)sb.append(String.format(Locale.US,"%02x",b&0xff));
        token=sb.toString();profile=p;host=ip;expires=System.currentTimeMillis()+LIFE_MS;attempts=0;saved=false;
        ServerSocket server=new ServerSocket(0,5,InetAddress.getByName(ip));server.setSoTimeout(1000);socket=server;
        Thread worker=new Thread(()->serve(server),"VelaPhonePairing");worker.setDaemon(true);worker.start();
        return "http://"+ip+":"+server.getLocalPort()+"/pair/"+token;
    }
    private void serve(ServerSocket server){
        while(socket==server&&System.currentTimeMillis()<expires&&!saved&&attempts<7){
            try(Socket client=server.accept()){
                client.setSoTimeout(5000);
                handle(client,server);
            }catch(SocketTimeoutException ignored){}catch(Exception e){if(socket==server)Log.w("VelaPairing","Local pairing request failed (content omitted)");}
        }
        synchronized(this){if(socket==server)stop();}
    }
    private static String clean(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;");}
    private String page(){return "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"+
        "<title>Vela phone setup</title><style>body{font:16px system-ui;background:#11262c;color:#fff;margin:auto;max-width:480px;padding:36px 20px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:8px 0 18px;border-radius:10px;border:0}button{background:#c5e6db;color:#123;padding:15px;font-weight:700}p,small{line-height:1.6;opacity:.8}</style>"+
        "<h1>Connect calendar to Vela</h1><p>Profile: "+clean(profile)+" · this pairing expires in 10 minutes.</p><form method='post'>"+
        "<label>Calendar address or label (optional)</label><input name='label' maxlength='80' placeholder='e.g. Duong · personal'>"+
        "<label>Google Calendar secret iCal address</label><input name='url' type='url' maxlength='4096' required autocomplete='off' placeholder='https://calendar.google.com/calendar/ical/…/basic.ics'>"+
        "<button type='submit'>Connect to Vela</button></form><small>On Google Calendar (desktop view): Settings → your calendar → Integrate calendar → Secret address in iCal format.</small>"+
        "<p><small>Only use this on your trusted home Wi-Fi. This local setup page uses HTTP, not HTTPS; your private calendar link travels on the local network. Avoid guest/public Wi-Fi.</small></p></html>";
    }
    private static void respond(OutputStream out,int code,String html){
        try{byte[] bytes=html.getBytes(StandardCharsets.UTF_8);String status=code==200?"OK":code==400?"Bad Request":code==403?"Forbidden":code==413?"Payload Too Large":"Not Found";
            String header="HTTP/1.1 "+code+" "+status+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "+bytes.length+
                "\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
        }catch(Exception ignored){}
    }
    private static Map<String,String> form(String body)throws Exception{
        Map<String,String> m=new HashMap<>();for(String kv:body.split("&")){int eq=kv.indexOf('=');if(eq<0)continue;
            String key=URLDecoder.decode(kv.substring(0,eq),"UTF-8");String val=URLDecoder.decode(kv.substring(eq+1),"UTF-8");m.put(key,val);}
        return m;
    }
    private void handle(Socket client,ServerSocket server)throws Exception{
        InputStream in=client.getInputStream();OutputStream out=client.getOutputStream();
        BufferedReader br=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));
        String line=br.readLine();if(line==null||line.length()>2048)return;
        String[] first=line.split(" ");if(first.length<3)return;
        String expected="/pair/"+token;
        String actual=first[1];String origin="";int length=-1;String hostHeader="";String contentType="";
        int lines=0;while((line=br.readLine())!=null&&!line.isEmpty()&&lines++<60){
            int colon=line.indexOf(':');if(colon<0)continue;
            String k=line.substring(0,colon).toLowerCase(Locale.US),v=line.substring(colon+1).trim();
            if(k.equals("content-length"))try{length=Integer.parseInt(v);}catch(Exception ignored){}
            else if(k.equals("origin"))origin=v;
            else if(k.equals("host"))hostHeader=v;
            else if(k.equals("content-type"))contentType=v;
        }
        String base="http://"+host+":"+server.getLocalPort();
        if(!actual.equals(expected)||System.currentTimeMillis()>expires||!hostHeader.equals(host+":"+server.getLocalPort())){
            respond(out,404,"<h3>Pairing closed</h3>");return;
        }
        if("GET".equals(first[0])){respond(out,200,page());return;}
        if(!"POST".equals(first[0])||!origin.equals(base)||!contentType.startsWith("application/x-www-form-urlencoded")){
            respond(out,403,"<h3>Request rejected</h3>");return;
        }
        attempts++;
        if(length<1||length>5500){respond(out,413,"<h3>Invalid input size</h3>");return;}
        char[] buffer=new char[length];int n=0;while(n<length){int x=br.read(buffer,n,length-n);if(x<0)break;n+=x;}
        if(n!=length){respond(out,400,"<h3>Incomplete input</h3>");return;}
        Map<String,String> values=form(new String(buffer));String url=values.getOrDefault("url","").trim();String label=values.getOrDefault("label","").trim();
        if(!VelaCalendarController.isValidGoogleCalendarLink(url)){
            respond(out,400,"<h3>Invalid Google Calendar address</h3><p>Copy your <b>Secret address in iCal format</b> from Google Calendar. Close this page and scan again to retry.</p>");return;
        }
        saved=true;calendar.saveLink(profile,url,label);
        respond(out,200,"<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{font:18px system-ui;background:#10272b;color:white;padding:50px 30px;line-height:1.6}</style><h2>Link transferred to Vela ✓</h2><p>Look at your TV for verification. A saved link is not yet a verified calendar. You may close this tab.</p>");
        activity.onPhoneCalendarSubmitted(profile);
    }
}
