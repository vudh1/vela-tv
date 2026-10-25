/* Samsung Tizen adapter. No Android APIs, network keys, or background services. */
(function () {
'use strict';
if (!window.tizen || window.QuietTV) return;
window.VelaPlatform = {kind:'tizen'};
document.body.classList.add('tizen-tv');
var pendingProfile = true, launchable = {};
function stored(key) { try { return localStorage.getItem('vela_'+key)||''; } catch(e) { return ''; } }
function store(key,value) { try { localStorage.setItem('vela_'+key,String(value)); } catch(e) {} }
function message(value) {
  // TV firmware may reject launching individual preinstalled apps.
  console.warn('Vela Samsung: '+value);
  window.alert(value);
}
window.QuietTV = {
  getSetting:stored,
  setSetting:store,
  getCachedApps:function(){return '';},
  getCachedCatalogAt:function(){return 0;},
  is24HourClock:function(){return false;},
  wakeProfilePromptEnabled:function(){return stored('ask_on_launch')!=='false';},
  setWakeProfilePromptEnabled:function(value){store('ask_on_launch',value?'true':'false');},
  consumeWakeProfilePrompt:function(){
    if (!this.wakeProfilePromptEnabled()) return false;
    var current = pendingProfile; pendingProfile = false; return current;
  },
  requestApps:function(){
    try {
      tizen.application.getAppsInfo(function(items){
        launchable={};
        var catalog=[];
        items.forEach(function(app){
          if(!app.show||!app.id||!app.name||app.id==='VelaTv0001.VelaTV')return;
          launchable[app.id]=true;
          catalog.push({id:app.id,package:app.packageId||app.id,name:app.name,icon:app.iconPath||''});
        });
        catalog.sort(function(a,b){return a.name.localeCompare(b.name);});
        if(window.QH)window.QH.receiveApps(catalog);
      },function(error){
        console.warn('Tizen app listing unavailable',error&&error.name);
        if(window.QH)window.QH.receiveApps([]);
      });
    } catch(e) {
      console.warn('Tizen application API unavailable',e);
      if(window.QH)window.QH.receiveApps([]);
    }
  },
  launchApp:function(id){
    if(!launchable[id])return;
    try {
      tizen.application.launch(id,function(){},function(err){
        message('Samsung did not allow Vela to open this app. Use Samsung Home to open it.');
      });
    }catch(e){message('This app cannot be opened from Vela on this TV.');}
  },
  requestWallpaper:function(){if(window.QH)window.QH.wallpaperReady('');},
  setCustomVolumeEnabled:function(){},
  updateStatus:function(){},
  cancelCalendarPair:function(){}
};
// The native TV Back key is 10009. Don't trap Home or Volume keys.
document.addEventListener('keydown',function(e){
  if (!window.QH)return;
  var key={37:'left',38:'up',39:'right',40:'down',13:'select',10009:'back'}[e.keyCode];
  if (!key)return;
  e.preventDefault();
  if(key==='back'&&!document.querySelector('#overlay:not(.hidden)')) {
    try {tizen.application.getCurrentApplication().exit();}catch(err){}
    return;
  }
  window.QH.remote(key);
});
window.addEventListener('load',function(){if(window.QH)window.QH.resume();});
document.addEventListener('visibilitychange',function(){
  if(!document.hidden&&window.QH)window.QH.resume();
});
})();
