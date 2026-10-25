#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/weather.js'),'utf8');
const elements=new Map(),store=new Map(),requested=[];
function el(id){
 if(!elements.has(id))elements.set(id,{
  textContent:'',attributes:{},hidden:true,
  classList:{add(name){if(name==='hidden')this.hidden=true;},remove(name){if(name==='hidden')this.hidden=false;}},
  setAttribute(name,value){this.attributes[name]=value;}
 });
 return elements.get(id);
}
const geo={ip:'203.0.113.5',isp:'This should never be saved',latitude:47.6,longitude:-122.3,city:'Seattle',region_code:'WA',country:'US'};
const weather={current:{temperature_2m:62.7,weather_code:61,precipitation:.02,is_day:1},
 hourly:{precipitation_probability:[70,60,45]}};
class MockXHR {
 open(method,url){assert.equal(method,'GET');this.url=url;requested.push(url);}
 send(){setImmediate(()=>{
  this.status=200;this.readyState=4;
  this.responseText=JSON.stringify(this.url.includes('ip-info.com')?geo:weather);
  this.onreadystatechange();
 });}
}
const ctx={console,document:{hidden:false,getElementById:el,addEventListener(){}},
 XMLHttpRequest:MockXHR,localStorage:{getItem(key){return store.get(key)||null;},setItem(key,value){store.set(key,value);}},
 setTimeout,clearTimeout,setInterval(){return 1;},clearInterval(){},Promise,Date,Math,JSON,Number,encodeURIComponent,isFinite};
ctx.window={VelaPlatform:{kind:'tizen'},QuietTV:{}};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'weather.js'});
const client=ctx.window.VelaWeatherClient;
assert.deepEqual(Array.from(client.wmo(0)),['Clear','sun']);
assert.deepEqual(Array.from(client.wmo(61)),['Rain','rain']);
assert.equal(client.snapshot({city:'Seattle',region:'WA',country:'US'},weather).unit,'F');
assert.equal(client.snapshot({city:'Paris',region:'',country:'FR'},weather).precipUnit,'mm');
function until(predicate){return new Promise((resolve,reject)=>{
 let tries=0;function poll(){if(predicate())resolve();else if(++tries>150)reject(Error('Weather timed out'));else setTimeout(poll,15);}poll();
});}
(async()=>{
 client.start();
 await until(()=>el('weatherTemp').textContent==='63°F');
 assert.equal(requested.length,2,'one IP lookup plus one weather request');
 assert.match(requested[1],/timezone=UTC/);
 assert.equal(el('weatherLocation').textContent,'Seattle, WA');
 assert.equal(el('weatherCondition').textContent,'Rain');
 assert.match(el('weatherPrecip').textContent,/Precip now 0\.02 in · 70% next hour/);
 assert.equal(el('weatherCard').attributes['data-kind'],'rain');
 assert.equal(el('weatherCard').classList.hidden,false);
 const cache=[...store.values()].join(' ');
 assert.ok(!cache.includes(geo.ip)&&!cache.includes(geo.isp),'do not persist public IP or ISP');
 client.receive({...client.snapshot({city:'Seattle',region:'WA',country:'US'},weather),updatedAt:Date.now()-91*60000});
 assert.equal(el('weatherCard').classList.hidden,true,'never show weather older than 90 minutes');
 client.stop();
 console.log('PASS passive IP-local weather, Fahrenheit/rain, asynchronous requests, privacy and stale-data fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
