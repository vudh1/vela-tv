#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/tizen-bridge.js'),'utf8');
const settings=new Map();
const listeners={};
let apps=[],launches=[],screens=[];
const fakeQH={receiveApps(list){apps=list;},remote(key){screens.push(key);},resume(){}};
const doc={
  body:{classList:{add() {}}},
  addEventListener(name,handler){listeners[name]=handler;},
  querySelector(){return {}} // When Back is pressed inside a panel.
};
const ctx={
  console,window:{tizen:{},QH:fakeQH,addEventListener(name,handler){listeners[name]=handler;}},
  document:doc,
  localStorage:{getItem(key){return settings.get(key)||null;},setItem(key,value){settings.set(key,value);}},
  tizen:{application:{
    getAppsInfo(success){success([
      {id:'VelaTv0001.VelaTV',name:'Vela',show:true},
      {id:'ABCDEFGHIJ.Stream',name:'Stream',show:true,iconPath:'file:///icon.png'},
      {id:'KLMNOPQRST.Background',name:'Background Worker',show:true},
      {id:'hidden.app',name:'Private',show:false}
    ]);},
    launch(id,done){launches.push(id);done();}
  }}
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'tizen-bridge.js'});
const bridge=ctx.window.QuietTV;
assert.equal(ctx.window.VelaPlatform.kind,'tizen');
assert.equal(bridge.consumeWakeProfilePrompt(),true,'first visible launch prompts');
assert.equal(bridge.consumeWakeProfilePrompt(),false,'app return does not prompt');
bridge.setWakeProfilePromptEnabled(false);
assert.equal(bridge.wakeProfilePromptEnabled(),false);
bridge.setSetting('active_profile_v2','tram');
assert.equal(bridge.getSetting('active_profile_v2'),'tram');
bridge.requestApps();
assert.equal(apps.length,1,'only installed/visible apps listed');
assert.equal(apps[0].id,'ABCDEFGHIJ.Stream');
bridge.launchApp('ABCDEFGHIJ.Stream');
bridge.launchApp('hidden.app');
assert.deepEqual(launches,['ABCDEFGHIJ.Stream'],'cannot launch an undiscovered target');
let prevented=false;
listeners.keydown({keyCode:10009,preventDefault(){prevented=true;}});
assert.ok(prevented);
assert.deepEqual(screens,['back']);
let blurred=false;
doc.activeElement={tagName:'INPUT',blur(){blurred=true;}};
prevented=false;
listeners.keydown({keyCode:40,preventDefault(){prevented=true;}});
assert.ok(blurred&&prevented,'Down leaves the Samsung calendar keyboard');
assert.deepEqual(screens,['back','down'],'normal Vela navigation resumes at Save');
console.log('PASS Samsung Tizen bridge, local profiles, app filtering, launch guard and Back remote');
