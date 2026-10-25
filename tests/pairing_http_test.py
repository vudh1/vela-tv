#!/usr/bin/env python3
"""Exercise Vela's actual LAN pairing HTTP parser with JVM-only Android stubs.
No real calendar URL, Google request, user data, TV, or internet access required.
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
server = root / "app/src/main/java/com/danielvu/quiethome/VelaPairingServer.java"

harness = r"""
package com.danielvu.quiethome;

import java.io.*;
import java.net.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;

public final class PairingHttpTest {
    private static final String TOKEN="test-token-123", NONCE="test-nonce-456";
    private static final String CAL="https://calendar.google.com/calendar/ical/test%40example.com/private-test/basic.ics";
    private static final MainActivity activity=new MainActivity();
    private static final VelaCalendarController calendar=new VelaCalendarController();
    private static final VelaPairingServer pairing=new VelaPairingServer(activity,calendar);

    static void field(String name,Object value)throws Exception {
        Field f=VelaPairingServer.class.getDeclaredField(name);
        f.setAccessible(true);f.set(pairing,value);
    }
    static String call(String method,String body,String extra)throws Exception {
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){
            int port=server.getLocalPort();
            field("token",TOKEN);field("formNonce",NONCE);field("host","127.0.0.1");
            field("expires",System.currentTimeMillis()+600000L);
            String req=method+" /pair/"+TOKEN+" HTTP/1.1\r\nHost: 127.0.0.1:"+port+"\r\n";
            if(body!=null)req+="Content-Type: application/x-www-form-urlencoded\r\nContent-Length: "+
                body.getBytes(StandardCharsets.UTF_8).length+"\r\n";
            req+=extra+"\r\n"+(body==null?"":body);
            Throwable[] err={null};
            Thread handler=new Thread(()->{
                try(Socket peer=server.accept()){
                    Method m=VelaPairingServer.class.getDeclaredMethod("handle",Socket.class,ServerSocket.class);
                    m.setAccessible(true);m.invoke(pairing,peer,server);
                }catch(Throwable e){err[0]=e;}
            });
            handler.setDaemon(true);handler.start();
            byte[] response;
            try(Socket socket=new Socket("127.0.0.1",port)){
                socket.setSoTimeout(3000);
                socket.getOutputStream().write(req.getBytes(StandardCharsets.UTF_8));
                socket.shutdownOutput();
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                InputStream in=socket.getInputStream();byte[] buf=new byte[4096];int n;
                while((n=in.read(buf))!=-1)out.write(buf,0,n);
                response=out.toByteArray();
            }
            handler.join(3000);
            if(err[0]!=null)throw new AssertionError("Pairing server threw exception",err[0]);
            if(handler.isAlive())throw new AssertionError("Pairing server hung");
            return new String(response,StandardCharsets.UTF_8);
        }
    }
    static void expect(String response,String status,String message){
        if(!response.startsWith("HTTP/1.1 "+status)||!response.contains(message))
            throw new AssertionError("Unexpected response: "+response.substring(0,Math.min(150,response.length())));
    }
    static String payload(String nonce,String label)throws Exception {
        return "nonce="+URLEncoder.encode(nonce,"UTF-8")+"&label="+URLEncoder.encode(label,"UTF-8")+
            "&url="+URLEncoder.encode(CAL,"UTF-8");
    }
    public static void main(String[] args)throws Exception {
        expect(call("GET",null,""),"200","name='nonce' value='"+NONCE+"'");
        // The form nonce, not unreliable browser Origin metadata, is the
        // authorization check. Cross-site attempts without it remain rejected.
        expect(call("POST",payload("invalid","label"),"Origin: https://malicious.example\r\n"),"403","Pairing form expired");
        expect(call("POST",payload("invalid","label"),"Sec-Fetch-Site: cross-site\r\n"),"403","Pairing form expired");
        expect(call("POST",payload("invalid","label"),""),"403","Pairing form expired");
        // Mobile QR webviews may supply an opaque Origin or alternate
        // Fetch Metadata and must still work if the form nonce is genuine.
        expect(call("POST",payload(NONCE,"opaque"),"Origin: null\r\nSec-Fetch-Site: same-site\r\n"),"200","Link transferred to Vela");
        expect(call("POST",payload(NONCE,"mobile"),"Sec-Fetch-Site: cross-site\r\n"),"200","Link transferred to Vela");
        String unicodeLabel="Dương · Gia đình";
        expect(call("POST",payload(NONCE,unicodeLabel),""),"200","Link transferred to Vela");
        if(!unicodeLabel.equals(calendar.label)||!CAL.equals(calendar.url)||!activity.saved)
            throw new AssertionError("UTF-8 form or saved callback was incorrect");
        expect(call("POST",payload(NONCE,"normal"),"Origin: http://127.0.0.1:1\r\n"),"200","Link transferred to Vela");
        System.out.println("PASS GET nonce, opaque/absent Origin, CSRF nonce rejection, cross-site metadata compatibility, UTF-8 POST framing");
    }
}
"""

stubs = {
    "android/net/Uri.java": "package android.net; public class Uri {}\n",
    "android/util/Log.java": "package android.util; public class Log { public static int w(String a,String b){return 0;} }\n",
    "com/danielvu/quiethome/MainActivity.java": (
        "package com.danielvu.quiethome; public class MainActivity { "
        "boolean saved=false; void onPhoneCalendarSubmitted(String p){saved=true;} }\n"
    ),
    "com/danielvu/quiethome/VelaCalendarController.java": (
        "package com.danielvu.quiethome; public class VelaCalendarController { "
        "String url,label; static boolean isValidCalendarLink(String s){ "
        'return s.startsWith("https://calendar.google.com/calendar/ical/") && s.endsWith(".ics") || '
        's.startsWith("https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics"); } '
        "void saveLink(String p,String u,String l){url=u;label=l;} }\n"
    ),
    "com/danielvu/quiethome/PairingHttpTest.java": harness,
}
with tempfile.TemporaryDirectory(prefix="vela-pairing-test-") as tmp:
    tmp = Path(tmp)
    for name, code in stubs.items():
        destination = tmp / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(code, encoding="utf-8")
    source = tmp / "com/danielvu/quiethome/VelaPairingServer.java"
    shutil.copyfile(server, source)
    java = [str(file) for file in tmp.rglob("*.java")]
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(tmp / "classes"), *java], check=True)
    subprocess.run(["java", "-cp", str(tmp / "classes"), "com.danielvu.quiethome.PairingHttpTest"], check=True)
