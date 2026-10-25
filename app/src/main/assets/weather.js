/* Passive IP-local weather. No location permission, API key or app-launch dependency. */
(function(root){
'use strict';
var TTL=15*60000,GEO_TTL=30*60000,MAX_AGE=90*60000;
var SNAP='vela_weather_snapshot_v1',GEO='vela_weather_geo_v1';
var enabled=false,timer=null,inflight=false,lastAttempt=0,current=null;
var tizen=!!(root.VelaPlatform&&root.VelaPlatform.kind==='tizen');
function localGet(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(e){return null;}}
function localPut(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}}
function numeric(v,low,high){return typeof v==='number'&&isFinite(v)&&v>=low&&v<=high;}
function short(v){return typeof v==='string'?v.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,65):'';}
function wmo(code){
 if(code===0)return ['Clear','sun'];
 if(code<=2)return ['Partly cloudy','cloud'];
 if(code===3)return ['Overcast','cloud'];
 if(code===45||code===48)return ['Foggy','cloud'];
 if(code>=51&&code<=57)return ['Drizzle','rain'];
 if(code>=61&&code<=67)return ['Rain','rain'];
 if(code>=71&&code<=77)return ['Snow','snow'];
 if(code>=80&&code<=82)return ['Showers','rain'];
 if(code>=85&&code<=86)return ['Snow showers','snow'];
 if(code>=95)return ['Thunderstorms','rain'];
 return ['Cloudy','cloud'];
}
function valid(s){return s&&numeric(s.updatedAt,1,Date.now()+60000)&&numeric(s.temperature,-140,140)&&
 (s.unit==='F'||s.unit==='C')&&numeric(s.precipitation,0,1000)&&
 (s.precipUnit==='in'||s.precipUnit==='mm')&&
 (s.rainChance===null||numeric(s.rainChance,0,100))&&
 ['sun','cloud','rain','snow'].indexOf(s.kind)>=0&&typeof s.condition==='string';}
function receive(payload){
 try{var s=typeof payload==='string'?JSON.parse(payload):payload;
  if(!valid(s)||!short(s.city)&&!short(s.region))return;
  current=s;if(tizen)localPut(SNAP,s);paint();
 }catch(e){} // A bad weather response must never affect Home.
}
function paint(){
 var box=document.getElementById('weatherCard');if(!box)return;
 if(!valid(current)||Date.now()-current.updatedAt>MAX_AGE){box.classList.add('hidden');return;}
 box.classList.remove('hidden');box.setAttribute('data-kind',current.kind);
 document.getElementById('weatherTemp').textContent=Math.round(current.temperature)+'°'+current.unit;
 document.getElementById('weatherCondition').textContent=short(current.condition);
 var place=short(current.city),area=short(current.country==='US'?current.region:current.country);
 document.getElementById('weatherLocation').textContent=place+(place&&area?', ':'')+area;
 var p=current.precipitation,amount=p.toFixed(current.precipUnit==='in'?2:1)+' '+current.precipUnit;
 var likelihood=current.rainChance===null?'':(' · '+Math.round(current.rainChance)+'% next hour');
 document.getElementById('weatherPrecip').textContent=(p>0?'Precip now '+amount:'Dry now')+likelihood;
}
function getJSON(url){return new Promise(function(resolve,reject){
  var req=new XMLHttpRequest(),done=false;
  function finish(err,value){if(done)return;done=true;if(err)reject(err);else resolve(value);}
  try{
   req.open('GET',url,true);req.timeout=8000;
   req.onreadystatechange=function(){if(req.readyState!==4)return;
    if(req.status!==200||!req.responseText||req.responseText.length>160000){finish(Error('Unavailable'));return;}
    try{finish(null,JSON.parse(req.responseText));}catch(e){finish(e);}
   };
   req.onerror=function(){finish(Error('Network unavailable'));};
   req.ontimeout=function(){finish(Error('Weather timed out'));};
   req.send();
  }catch(e){finish(e);}
 });}
function location(){
 var cached=localGet(GEO);
 if(cached&&numeric(cached.latitude,-90,90)&&numeric(cached.longitude,-180,180)&&Date.now()-cached.at<GEO_TTL)return Promise.resolve(cached);
 return getJSON('https://ip-info.com/json').then(function(g){
  if(!numeric(g.latitude,-90,90)||!numeric(g.longitude,-180,180))throw Error('IP location unavailable');
  // Never store the IP address, ISP, ASN, ZIP, or the complete service response.
  var result={latitude:g.latitude,longitude:g.longitude,city:short(g.city),region:short(g.region_code||g.region),country:short(g.country),at:Date.now()};
  localPut(GEO,result);return result;
 });
}
function snapshot(g,response){
 var d=response&&response.current,h=response&&response.hourly;
 if(!d||!numeric(d.temperature_2m,-140,140)||!numeric(d.precipitation,0,1000))throw Error('Invalid forecast');
 var code=Number(d.weather_code),status=wmo(code),chance=null;
 if(h&&Array.isArray(h.precipitation_probability)&&h.precipitation_probability.length){
  var found=h.precipitation_probability.find(function(v){return numeric(v,0,100);});
  if(found!==undefined)chance=found;
 }
 return {city:g.city,region:g.region,country:g.country,temperature:d.temperature_2m,
  unit:g.country==='US'?'F':'C',precipitation:d.precipitation,
  precipUnit:g.country==='US'?'in':'mm',rainChance:chance,
  condition:status[0],kind:status[1],updatedAt:Date.now()};
}
function fetchTizen(){return location().then(function(g){
 var units=g.country==='US'?'&temperature_unit=fahrenheit&precipitation_unit=inch':'';
 var url='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(g.latitude)+
  '&longitude='+encodeURIComponent(g.longitude)+
  '&current=temperature_2m,weather_code,precipitation,is_day'+
  '&hourly=precipitation_probability&timezone=UTC&forecast_hours=3'+units;
 return getJSON(url).then(function(response){return snapshot(g,response);});
});}
function refresh(){
 if(!enabled||document.hidden||inflight||Date.now()-lastAttempt<2*60000)return;
 lastAttempt=Date.now();
 if(tizen){inflight=true;fetchTizen().then(receive).catch(function(){}).then(function(){inflight=false;});}
 else if(root.QuietTV&&root.QuietTV.requestWeather){try{root.QuietTV.requestWeather(false);}catch(e){}}
}
function resume(){if(!enabled)return;paint();if(!current||Date.now()-current.updatedAt>=TTL)refresh();}
function start(){
 if(enabled)return;enabled=true;
 if(tizen)receive(localGet(SNAP));
 // Never wait on a weather request before initializing the launcher or apps.
 setTimeout(refresh,900);
 timer=setInterval(function(){paint();if(!document.hidden)refresh();},TTL);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)resume();});
}
function stop(){enabled=false;if(timer)clearInterval(timer);timer=null;}
root.VelaWeatherClient={start:start,resume:resume,stop:stop,receive:receive,wmo:wmo,snapshot:snapshot};
})(window);
