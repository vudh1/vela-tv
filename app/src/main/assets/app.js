/* Vela 2.4 — small tvOS-inspired touches, without new Home-screen clutter. */
(function () {
'use strict';
var bridge=window.QuietTV||null, preview=!bridge;
var tizenMode=!!(window.VelaPlatform&&window.VelaPlatform.kind==='tizen');
var apps=[],appsById={},catalogSignature='',fav=[],mode='dock',theme='dark',scenery='0',appLabelMode='focus';
var profiles=[],profileId='duong',fontStyle='classic',clockFormat='auto',rotationMinutes=0,rotationTimer=null;
var pendingRemoteSettings=false;
var monitorEnabled=false; // profile-scoped, hidden by default; no background streaming
// Volume settings are device-wide, not profile-specific: the TV audio output is shared.
var volumeMode='glass',volumePercent=false,volumePosition='center',volumeDelay=1200,volumeTimer=null,lastVolume={percent:45,muted:false};
var calEvents=[],calConnected=false,calVerified=false,calStatus='',calLabel='',calName='',calAccount='',calLastSuccess=0,calLastAttempt=0,calTimer=null,calendarProfile='',calendarChecked=0,pairingUrl='',pairingExpiresAt=0,pairTimer=null;
var calSources=[],calendarFilter='all',calendarViewEvents=[],selectedEvent=null,selectedSource='google';
var reminderTimer=null,remindedEvents={},reminderWindowMs=15*60000,reminderVisibleMs=7000,lastCalendarMarkup='';
// Original Vela constellation medallions: crisp two-tone SVGs at any TV resolution.
// Keep the stored avatar identifiers stable when updating the artwork.
var avatars={
 orbit:'<circle class="art-haze" cx="32" cy="32" r="16"/><circle class="art-fill" cx="32" cy="32" r="11"/><path class="art-sheen" d="M25 29a9 9 0 0 1 11-5"/><ellipse class="art-stroke" cx="32" cy="32" rx="28" ry="10" transform="rotate(-26 32 32)"/><circle class="art-spark" cx="53" cy="21" r="2.8"/><path class="art-fine" d="M16 12v8m-4-4h8"/>',
 flower:'<ellipse class="art-fill" cx="32" cy="20" rx="8" ry="13"/><ellipse class="art-fill" cx="32" cy="44" rx="8" ry="13"/><ellipse class="art-soft" cx="20" cy="32" rx="13" ry="8"/><ellipse class="art-soft" cx="44" cy="32" rx="13" ry="8"/><ellipse class="art-soft" cx="32" cy="20" rx="8" ry="13" transform="rotate(45 32 32)"/><ellipse class="art-soft" cx="32" cy="20" rx="8" ry="13" transform="rotate(-45 32 32)"/><ellipse class="art-soft" cx="32" cy="44" rx="8" ry="13" transform="rotate(45 32 32)"/><ellipse class="art-soft" cx="32" cy="44" rx="8" ry="13" transform="rotate(-45 32 32)"/><circle class="art-core" cx="32" cy="32" r="9"/><circle class="art-spark" cx="32" cy="32" r="3"/>',
 guest:'<circle class="art-haze" cx="32" cy="31" r="25"/><circle class="art-fill" cx="32" cy="23" r="11"/><path class="art-soft" d="M10 55c1-14 10-21 22-21s21 7 22 21Z"/><path class="art-fine" d="M13 22a20 20 0 0 1 17-14m16 7 4 4m-4 0 4-4"/>',
 mountain:'<circle class="art-haze" cx="46" cy="17" r="7"/><path class="art-soft" d="M4 50 25 15l12 20 6-9 18 24Z"/><path class="art-fill" d="m14 50 18-27 19 27Z"/><path class="art-core" d="m18 27 7-12 8 14-8-4Z"/><path class="art-sheen" d="m23 36 9-13 9 13-9-4Z"/><path class="art-fine" d="M6 54h52"/>',
 sun:'<circle class="art-haze" cx="32" cy="32" r="22"/><circle class="art-fill" cx="32" cy="32" r="14"/><circle class="art-core" cx="32" cy="32" r="9"/><path class="art-stroke" d="M32 3v9m0 40v9M3 32h9m40 0h9M11.5 11.5l6.5 6.5m28 28 6.5 6.5m0-41L46 18m-28 28-6.5 6.5"/><path class="art-sheen" d="M24 28a10 10 0 0 1 12-5"/>',
 moon:'<circle class="art-haze" cx="31" cy="34" r="23"/><path class="art-fill" d="M45 47A23 23 0 0 1 26 8a21 21 0 1 0 19 39Z"/><path class="art-sheen" d="M22 48A18 18 0 0 1 15 28"/><path class="art-spark" d="m46 11 2.5 6.5L55 20l-6.5 2.5L46 29l-2.5-6.5L37 20l6.5-2.5Z"/><circle class="art-spark" cx="54" cy="42" r="2"/>',
 wave:'<path class="art-haze" d="M5 34c9-11 15-11 25 0s18 10 29-2v20H5Z"/><path class="art-fill" d="M3 37c10-13 18-13 28-1 10 12 20 9 30-1v12c-10 10-20 12-30 0-10-12-18-12-28 1Z"/><path class="art-stroke" d="M4 26c9-11 18-12 27 0s20 11 29-1M4 53c11-7 17-7 27 0s19 6 29 0"/><path class="art-fine" d="m14 13 4-6 4 6m23 2 4-6 4 6"/>',
 star:'<path class="art-haze" d="M32 2 40 24 62 32 40 40 32 62 24 40 2 32 24 24Z"/><path class="art-fill" d="m32 8 6.8 17.2L56 32l-17.2 6.8L32 56l-6.8-17.2L8 32l17.2-6.8Z"/><circle class="art-core" cx="32" cy="32" r="7"/><path class="art-spark" d="m51 5 1.5 5L58 12l-5.5 2L51 19l-1.5-5L44 12l5.5-2Z"/><circle class="art-spark" cx="12" cy="52" r="2.5"/>',
 leaf:'<path class="art-haze" d="M55 7C25 7 9 15 10 35c1 17 18 24 31 12S53 23 55 7Z"/><path class="art-fill" d="M53 10C20 12 9 22 14 40c7 15 25 12 33-2s5-24 6-28Z"/><path class="art-stroke" d="M11 57c7-20 17-31 35-41m-21 25-8-10m15 3-2-14m9 8 11-3"/><path class="art-spark" d="m49 47 3 3 4-3-4 4 3 4-4-3-3 4 2-5Z"/>',
 cat:'<path class="art-soft" d="m12 27 2-19 13 11c3-1 7-1 10 0L50 8l2 19c5 18-5 31-20 31S7 45 12 27Z"/><path class="art-fill" d="M17 29c0-4 2-9 5-12l7 7c3-1 5-1 8 0l7-7c3 3 5 8 5 12 0 15-7 24-17 24s-17-9-15-24Z"/><path class="art-core" d="m23 35 3-2 3 2-3 3Zm15 0-3-2-3 2 3 3Z"/><path class="art-stroke" d="m29 44 3 2 3-2m-3 2v3m-11-7-9-2m9 6-10 1m32-5 9-2m-9 6 10 1"/><path class="art-sheen" d="M18 28q5-5 10-4"/>'
};
var avatarList=['initial','orbit','flower','guest','mountain','sun','moon','wave','star','leaf','cat'];
function profileInitials(name){var words=String(name||'').trim().split(/\s+/).filter(Boolean);return (words.length>1?words[0].charAt(0)+words[words.length-1].charAt(0):(words[0]||'G').charAt(0)).toUpperCase();}
function avatarSvg(id,name){if(id==='initial')return '<span class="avatar-initials">'+esc(profileInitials(name))+'</span>';var kind=avatars[id]?id:'orbit';return '<svg class="avatar-art avatar-tone-'+kind+'" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'+avatars[kind]+'</svg>';}

var wallpapers=[
 {name:'Alpine',src:'landscape.svg'}, {name:'Dusk',src:'landscape-1.svg'},
 {name:'Dawn',src:'landscape-2.svg'}, {name:'Moonlight',src:'landscape-3.svg'},
 {name:'Misty Lake',src:'wallpapers/mist-lake.webp',src4k:'wallpapers/mist-lake-4k.webp',thumb:'wallpapers/thumb-mist-lake.webp'},
 {name:'Blue Coast',src:'wallpapers/blue-coast.webp',src4k:'wallpapers/blue-coast-4k.webp',thumb:'wallpapers/thumb-blue-coast.webp'},
 {name:'Amber Dunes',src:'wallpapers/amber-dunes.webp',src4k:'wallpapers/amber-dunes-4k.webp',thumb:'wallpapers/thumb-amber-dunes.webp'},
 {name:'Lavender Bay',src:'wallpapers/lavender-bay.webp',src4k:'wallpapers/lavender-bay-4k.webp',thumb:'wallpapers/thumb-lavender-bay.webp'}
];
var screen='',cursor=0,controls=[],geometry=[],listDirty=true,focusedControl=null,iconCache={},pendingIcons={};
var contextAppId='',contextFrom='',recentMax=5,panelHistory=[],startupChooserOpen=false;
var lastCatalog=0,clockValue='',customPhoto='',toastTimer=null,clockTimer=null,updateStatus=null;
var $=function(s){return document.querySelector(s);};
var defaults=['com.google.android.youtube.tv','com.netflix.ninja','com.apple.atve.androidtv.appletv','com.niklabs.pp','com.wbd.stream','com.spotify.tv.android','com.disney.disneyplus','com.amazon.amazonvideo.livingroom'];
var tizenDefaults=['org.tizen.netflix-app','9Ur5IzDKqV.TizenYouTube','com.samsung.tv.aria-video','org.tizen.primevideo','MCmYXNxgcu.DisneyPlus','rJeHak5zRg.Spotify','3KA0pm7a7V.TubiTV'];
var demo=[['YouTube','com.google.android.youtube.tv'],['Netflix','com.netflix.ninja'],['Apple TV','com.apple.atve.androidtv.appletv'],['Perfect Player','com.niklabs.pp'],['Spotify','com.spotify.tv.android'],['Max','com.wbd.stream'],['Disney+','com.disney.disneyplus'],['Prime Video','com.amazon.amazonvideo.livingroom'],['Tubi','com.tubitv'],['Peacock','com.peacocktv.peacockandroid'],['Crunchyroll','com.crunchyroll.crunchyroid']];
function esc(s){return String(s||'').replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];});}
function get(k){try{return bridge?bridge.getSetting(k):localStorage.getItem('vela_'+k)||'';}catch(e){return '';}}
function save(k,v){try{if(bridge)bridge.setSetting(k,v);else localStorage.setItem('vela_'+k,v);}catch(e){}}
function byId(id){return appsById[id]||null;}
function toast(s){var t=$('#toast');t.textContent=s;t.classList.add('show');if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove('show');},1700);}
function system24Hour(){if(bridge&&bridge.is24HourClock){try{return !!bridge.is24HourClock();}catch(e){}}return false;}
function clock(){var n=new Date(),use24=clockFormat==='24'||(clockFormat==='auto'&&system24Hour());
 var hours=use24?n.getHours():(n.getHours()%12||12),v=(use24?('0'+hours).slice(-2):String(hours))+':'+('0'+n.getMinutes()).slice(-2);
 if(v!==clockValue){$('#clock').textContent=v;clockValue=v;}
 var d=n.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();if($('#daydate').textContent!==d)$('#daydate').textContent=d;}
function loadVolumePrefs(){
 volumeMode=get('volume_ui')||'glass';if(['glass','minimal','off'].indexOf(volumeMode)<0)volumeMode='glass';
 volumePercent=get('volume_percent')==='true';volumePosition=get('volume_position')==='right'?'right':'center';
 volumeDelay=get('volume_delay')==='short'?800:1200;
 applyVolumePrefs();
}
function applyVolumePrefs(){
 var hud=$('#volumeHud');if(!hud)return;
 hud.classList.toggle('glass',volumeMode==='glass'||volumeMode==='off');hud.classList.toggle('minimal',volumeMode==='minimal');
 hud.classList.toggle('bottom-right',volumePosition==='right');hud.classList.toggle('bottom-center',volumePosition!=='right');
 hud.classList.toggle('with-number',volumePercent);
 if(volumeMode==='off')hideVolume();
 if(bridge&&bridge.setCustomVolumeEnabled)bridge.setCustomVolumeEnabled(volumeMode!=='off');
}
function saveVolumePrefs(){save('volume_ui',volumeMode);save('volume_percent',String(volumePercent));
 save('volume_position',volumePosition);save('volume_delay',volumeDelay===800?'short':'normal');applyVolumePrefs();}
function hideVolume(){if(volumeTimer)clearTimeout(volumeTimer);volumeTimer=null;var hud=$('#volumeHud');
 if(hud){hud.classList.remove('visible');hud.setAttribute('aria-hidden','true');}}
function volumeChanged(payload,previewOnly){
 if(volumeMode==='off'&&!previewOnly)return;
 try {var v=typeof payload==='string'?JSON.parse(payload):payload||{};
  var p=Math.max(0,Math.min(100,Math.round(Number(v.percent)||0)));
  var mute=!!v.muted||p===0;lastVolume={percent:p,muted:mute};
  var hud=$('#volumeHud');hud.classList.toggle('muted',mute);
  hud.classList.toggle('low',!mute&&p<35);hud.classList.toggle('high',!mute&&p>=35);
  $('#volumeFill').style.transform='scaleX('+(mute?0:p/100)+')';
  $('#volumeNumber').textContent=mute?'Muted':p+'%';
  hud.classList.add('visible');hud.setAttribute('aria-hidden','false');
  if(volumeTimer)clearTimeout(volumeTimer);
  volumeTimer=setTimeout(hideVolume,volumeDelay);
 }catch(error){} // Volume is noncritical: never interrupt remote navigation.
}
function rescheduleClock(){clock();if(clockTimer)clearTimeout(clockTimer);clockTimer=setTimeout(rescheduleClock,60000-(Date.now()%60000)+40);}
function setScenery(){var n=parseInt(scenery,10)||0;if(n<0||n>=wallpapers.length)n=0;scenery=String(n);
 document.body.setAttribute('data-scenery',scenery);
 // Keep UHD artwork for 1080p+ and true 4K screens; 720p sets avoid a 4K decode.
 var effectiveWidth=Math.max(window.screen&&window.screen.width||0,window.innerWidth||0)*(window.devicePixelRatio||1);
 var artwork=wallpapers[n].src4k&&effectiveWidth>=1280?wallpapers[n].src4k:wallpapers[n].src;
 $('#wallpaper').style.backgroundImage=customPhoto?'url("'+customPhoto+'")':'url("'+artwork+'")';}
function makeProfile(id,name,legacy){return {id:id,name:name,avatar:id==='tram'?'flower':id==='guest'?'guest':'initial',favorites:legacy&&legacy.favorites?legacy.favorites:null,
 layout:legacy&&legacy.layout||'dock',theme:legacy&&legacy.theme||'dark',scenery:legacy&&legacy.scenery||'0',font:'classic',clockFormat:'auto',recent:[],usage:[],appSort:'name',labels:'focus',channels:{},rotate:0,monitorEnabled:false};}
function currentProfile(){for(var i=0;i<profiles.length;i++)if(profiles[i].id===profileId)return profiles[i];return profiles[0];}
function persistProfiles(){save('profile_data_v2',JSON.stringify({profiles:profiles.filter(function(p){return p.id!=='guest';})}));
 // The native screensaver reads this active-profile marker. Write Guest while
 // Guest is foreground so a later DreamService cannot show Duong's cached events.
 // initProfiles() intentionally restores Duong instead on a new app launch.
 save('active_profile_v2',profileId);}
function persistAppearance(){var p=currentProfile();if(!p)return;p.favorites=fav.slice(0,8);p.layout=mode;p.theme=theme;p.scenery=scenery;p.font=fontStyle;p.rotate=rotationMinutes;p.monitorEnabled=monitorEnabled;p.clockFormat=clockFormat;p.labels=appLabelMode;persistProfiles();}
function initProfiles(){var parsed=null;try{parsed=JSON.parse(get('profile_data_v2')||'null');}catch(e){}
 if(parsed&&Array.isArray(parsed.profiles)&&parsed.profiles.length){profiles=parsed.profiles.filter(function(p){return p&&p.id!=='guest'&&typeof p.id==='string'&&typeof p.name==='string';}).map(function(p){
   return {id:p.id,name:p.name.slice(0,24),avatar:p.avatar==='initial'?'initial':avatars[p.avatar]?p.avatar:(p.id==='tram'?'flower':'initial'),favorites:Array.isArray(p.favorites)?p.favorites.slice(0,8):null,
    layout:p.layout==='list'?'list':'dock',theme:p.theme==='light'?'light':'dark',scenery:String(p.scenery||'0'),font:p.font==='modern'?'modern':'classic',clockFormat:['auto','12','24'].indexOf(p.clockFormat)>=0?p.clockFormat:'auto',recent:Array.isArray(p.recent)?p.recent.filter(function(v){return typeof v==='string';}).slice(0,5):[],usage:Array.isArray(p.usage)?p.usage.filter(function(v){return v&&typeof v.id==='string'&&Number.isFinite(v.at);}).slice(-750):[],appSort:['name','recent','week','month','quarter'].indexOf(p.appSort)>=0?p.appSort:'name',labels:['focus','both','names'].indexOf(p.labels)>=0?p.labels:'focus',channels:Object.fromEntries(Object.entries(p.channels&&typeof p.channels==='object'&&!Array.isArray(p.channels)?p.channels:{}).filter(function(e){return e[0].length<=240&&typeof e[1]==='string'&&e[1].length<=80;}).slice(-100)),rotate:p.rotate===30?30:0,monitorEnabled:p.monitorEnabled===true};
 });}
 if(!profiles.length){var oldFav=null;try{var f=JSON.parse(get('favorites')||'null');if(Array.isArray(f)&&f.length)oldFav=f;}catch(e){}
   var legacy={favorites:oldFav,layout:get('layout')||'dock',theme:get('theme')||'dark',scenery:get('scenery')||'0'};
   profiles=[makeProfile('duong','Duong',legacy),makeProfile('tram','Tram',null)];
 }
 if(!profiles.some(function(p){return p.id==='guest';}))profiles.push(makeProfile('guest','Guest',null));
 profileId=get('active_profile_v2')||'duong';if(profileId==='guest')profileId='duong';if(!profiles.some(function(p){return p.id===profileId;}))profileId=profiles[0].id;
 applyProfile(false);persistProfiles();}
function applyProfile(showHome){var p=currentProfile();if(!p)return;
 fav=Array.isArray(p.favorites)?p.favorites.slice(0,8):[];if(p.favorites===null&&apps.length){var seeded=[];(tizenMode?tizenDefaults:defaults).forEach(function(pkg){apps.forEach(function(a){if((tizenMode?a.id:a.package)===pkg&&seeded.indexOf(a.id)<0)seeded.push(a.id);});});if(!seeded.length)seeded=apps.slice(0,7).map(function(a){return a.id;});fav=seeded.slice(0,8);p.favorites=fav.slice();if(profileId!=='guest')persistProfiles();}mode=p.layout==='list'?'list':'dock';theme=p.theme==='light'?'light':'dark';
 scenery=p.scenery||'0';fontStyle=p.font==='modern'?'modern':'classic';clockFormat=['auto','12','24'].indexOf(p.clockFormat)>=0?p.clockFormat:'auto';clockValue='';clock();rotationMinutes=p.rotate===30?30:0;
 appLabelMode=['focus','both','names'].indexOf(p.labels)>=0?p.labels:'focus';document.body.setAttribute('data-app-labels',appLabelMode);
 monitorEnabled=p.monitorEnabled===true;$('#monitorButton').classList.toggle('hidden',!monitorEnabled);
 document.body.classList.toggle('light',theme==='light');document.body.classList.toggle('modern-clock',fontStyle==='modern');
 var btn=$('#profileButton');btn.innerHTML=avatarSvg(p.avatar,p.name);btn.title=p.name+' — Switch profile';btn.setAttribute('aria-label','Profile: '+p.name+'. Switch profile');
 customPhoto='';setScenery();calendarProfile='';calEvents=[];calSources=[];selectedEvent=null;calendarFilter='all';calConnected=false;calVerified=false;calStatus='';calLabel='';calName='';calAccount='';calLastSuccess=0;calLastAttempt=0;updateCalendarView();if(profileId!=='guest')requestCalendar(false);if(showHome){home();scheduleRotation();}}
function scheduleRotation(){if(rotationTimer)clearTimeout(rotationTimer);rotationTimer=null;
 if(!rotationMinutes||screen||document.hidden)return;
 rotationTimer=setTimeout(function(){if(!screen&&!document.hidden){scenery=String(((parseInt(scenery,10)||0)+1)%wallpapers.length);customPhoto='';setScenery();persistAppearance();}
   scheduleRotation();},rotationMinutes*60000);
}
function profileNameReady(kind,id,name){name=String(name||'').trim().replace(/\s+/g,' ').slice(0,24);if(!name){toast('Name cannot be empty');return;}
 if(kind==='add'){if(profiles.length>=8){toast('Maximum eight profiles');return;}var unique='p'+Date.now().toString(36);while(profiles.some(function(p){return p.id===unique;}))unique+='x';profiles.push(makeProfile(unique,name,null));profileId=unique;}
 else if(kind==='rename'){if(id==='guest'){toast('Guest name is fixed');return;}for(var i=0;i<profiles.length;i++)if(profiles[i].id===id)profiles[i].name=name;}
 persistProfiles();applyProfile(true);renderPanel('profiles',{act:'switchProfile',id:profileId});}
function profileDeleteConfirmed(id){if(id==='guest'){toast('Guest is always available');return;}if(profiles.length<2){toast('Keep at least one profile');return;}if(bridge&&bridge.removeCalendar)bridge.removeCalendar(id);
 profiles=profiles.filter(function(p){return p.id!==id;});if(profileId===id)profileId=profiles[0].id;
 persistProfiles();applyProfile(true);renderPanel('profiles',{act:'switchProfile',id:profileId});}
function wallpaperGallery(){var s='<div class="gallery-grid">';wallpapers.forEach(function(w,i){s+='<button class="wallpaper-choice focusable'+(scenery===String(i)?' is-current':'')+'" data-act="chooseWallpaper" data-id="'+i+'" aria-label="Use '+esc(w.name)+'"><img src="'+esc(w.thumb||w.src)+'" loading="lazy" decoding="async" alt=""><span>'+esc(w.name)+'</span><b>'+(scenery===String(i)?'✓':'')+'</b></button>';});
 return s+'</div><p class="library-footnote">Eight bundled, offline backgrounds. Changes preview instantly and save to this profile.</p>';}
function profileChooser(){var s='<div class="profiles-list">';profiles.forEach(function(p){var active=p.id===profileId;
 s+='<div class="profile-inline"><button class="profile-switch focusable'+(active?' is-current':'')+'" data-act="switchProfile" data-id="'+esc(p.id)+'"><span class="profile-mini">'+avatarSvg(p.avatar,p.name)+'</span><span class="profile-name">'+esc(p.name)+'</span><span class="profile-current">'+(active?'CURRENT':'')+'</span></button>'+
 '<button class="profile-manage focusable" data-act="avatarPicker" data-id="'+esc(p.id)+'" aria-label="Choose '+esc(p.name)+' avatar">◈</button>'+
 '<button class="profile-manage focusable" data-act="renameProfile" data-id="'+esc(p.id)+'" aria-label="Rename '+esc(p.name)+'" '+(p.id==='guest'?'disabled':'')+'>✎</button>'+
 '<button class="profile-manage remove-profile focusable" data-act="deleteProfile" data-id="'+esc(p.id)+'" aria-label="Delete '+esc(p.name)+'" '+(p.id==='guest'||profiles.length<=2?'disabled':'')+'>×</button></div>';});
 return s+'</div>'+row('addProfile','Add profile','+','Create another saved Home layout')+'<p class="library-footnote">Guest always starts fresh: no saved layout, calendar, or personal cache. Other profiles keep their preferences.</p>';}
var editingAvatar='';
function avatarPicker(){var p=profiles.filter(function(x){return x.id===editingAvatar;})[0],b='<div class="avatar-grid">';avatarList.forEach(function(a){b+='<button class="avatar-option focusable'+(p&&p.avatar===a?' is-current':'')+'" data-act="chooseAvatar" data-id="'+esc(a)+'" aria-label="'+esc(a)+' avatar">'+avatarSvg(a,p&&p.name||'Guest')+'<span>'+esc(a.charAt(0).toUpperCase()+a.slice(1))+'</span></button>';});return b+'</div>';}
function appFallback(){return '<svg class="fallback-app-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 8h8v8H8z"/></svg>';}
function icon(a){var uri=preview?'':tizenMode?(a.icon&&/^file:\/\//.test(a.icon)?a.icon:''):'https://vela-icons.local/icon/'+encodeURIComponent(a.id)+'?quality=hq384-v3';return '<span class="app-icon-frame">'+appFallback()+(uri?'<img class="app-icon" loading="eager" decoding="async" alt="" src="'+esc(uri)+'" onerror="this.style.display=\'none\'">':'')+'</span>';}

function tile(a,act){return '<button class="app-card focusable" data-act="'+act+'" data-id="'+esc(a.id)+'" data-name="'+esc(a.name)+'" title="'+esc(a.name)+'" aria-label="'+esc(a.name)+'">'+icon(a)+'<span class="app-name home-tile-name">'+esc(a.name)+'</span></button>';}
function populateCatalog(incoming,fromCache){if(!Array.isArray(incoming))return;
 var signature=JSON.stringify(incoming);if(signature===catalogSignature){lastCatalog=Date.now();return;}
 catalogSignature=signature;apps=incoming;appsById={};for(var i=0;i<apps.length;i++)appsById[apps[i].id]=apps[i];
 var p=currentProfile();var next=fav.filter(function(id){return !!byId(id);});
 if(p&&p.favorites===null){(tizenMode?tizenDefaults:defaults).forEach(function(pkg){apps.forEach(function(a){if((tizenMode?a.id:a.package)===pkg&&next.indexOf(a.id)<0)next.push(a.id);});});
 if(!next.length)next=apps.slice(0,7).map(function(a){return a.id;});}
 fav=next.slice(0,8);if(p){p.favorites=fav.slice();if(profileId!=='guest')persistProfiles();}lastCatalog=Date.now();home();if(screen){renderPanel(screen,null,true);}
}
function receiveApps(json){try{populateCatalog(typeof json==='string'?JSON.parse(json):json,false);}catch(e){toast('Could not load TV apps');}}
function catalogRefreshed(){lastCatalog=Date.now();}
function refreshApps(){if(preview){receiveApps(demo.map(function(a){return {id:a[1]+'/.MainActivity',package:a[1],name:a[0]};}));return;}if(bridge&&bridge.requestApps)bridge.requestApps();}
/* Binary Android icon requests are loaded by WebView off the JavaScript thread,
   served from a disk cache using a local, non-network origin. */
function iconReady(){}
function visibleIcons(){}
function home(){var arr=fav.map(byId).filter(Boolean),f=$('#favorites');f.className='favorites '+mode;
 f.innerHTML=arr.length?arr.map(function(a){return tile(a,'launch');}).join(''):'<div class="empty-home">Choose your favorite apps from the gear.</div>';
 listDirty=true;visibleIcons();if(!screen){activeList();select(Math.max(0,controls.findIndex(function(el){return el.classList.contains('app-card');})));}}
/* Geometry is calculated only when markup, scroll or viewport changes—not for every remote key. */
function activeList(){if(!listDirty)return;var root=screen?$('#overlay'):$('.page');controls=Array.prototype.slice.call(root.querySelectorAll('button.focusable:not([disabled])')).filter(function(el){return el.getClientRects().length>0;});
 geometry=controls.map(function(el){var r=el.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,top:r.top};});listDirty=false;}
function labelSelected(el){var label=$('#focusLabel');if(screen||appLabelMode!=='focus'||!el||!el.classList.contains('app-card')){label.classList.remove('visible');return;}
 var a=byId(el.getAttribute('data-id'));if(!a){label.classList.remove('visible');return;}var g=geometry[cursor];if(!g)return;
 label.textContent=a.name;label.style.left=g.x+'px';label.style.top=(g.top-39)+'px';label.classList.add('visible');}
function select(i){activeList();if(!controls.length)return;var old=focusedControl;cursor=Math.max(0,Math.min(controls.length-1,i));if(old){old.classList.remove('selected');old.setAttribute('tabindex','-1');}
 var el=controls[cursor];focusedControl=el;el.classList.add('selected');el.setAttribute('tabindex','0');if(document.activeElement!==el)el.focus({preventScroll:true});
 if(screen){var host=$('#panelContent'),r=el.getBoundingClientRect(),box=host.getBoundingClientRect();if(host.contains(el)&&(r.top<box.top+10||r.bottom>box.bottom-12)){el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});listDirty=true;}}
 labelSelected(el);}
// Settings labels use consistent Title Case without changing profile names,
// acronyms (TV/IP/PIN), or the established iCal spelling.
function uiTitle(text){return String(text).replace(/(^|[\s/&\u00b7\u2013\u2014-])([a-z][A-Za-z]*)/g,function(_,sep,word){return sep+(word==='iCal'?word:word.charAt(0).toUpperCase()+word.slice(1));});}
function row(act,title,right,sub,id){return '<button class="panel-row focusable" data-act="'+act+'"'+(id?' data-id="'+esc(id)+'"':'')+'><span><span class="row-title">'+esc(uiTitle(title))+'</span><span class="row-sub">'+esc(sub||'')+'</span></span><span class="row-right">'+esc(right||'')+' <span class="chevron">›</span></span></button>';}
function appRow(act,title,right,sub,id){return row(act,title,right,sub).replace('data-act="'+act+'"','data-act="'+act+'" data-id="'+esc(id)+'"');}
function eventKey(e){return e?String(e.uid||e.title).slice(0,180)+'/'+e.start:'';}
function savedChannel(e){var p=currentProfile();return e&&p&&p.channels&&p.channels[eventKey(e)]||e&&e.channel||'';}
function watchChannelReady(key,value){if(!selectedEvent||eventKey(selectedEvent)!==key)return;
 var p=currentProfile();if(!p)return;if(!p.channels)p.channels={};
 var station=String(value||'').replace(/[\r\n<>]/g,' ').trim().slice(0,80);
 if(station)p.channels[key]=station;else delete p.channels[key];
 var keys=Object.keys(p.channels);if(keys.length>100)keys.slice(0,keys.length-100).forEach(function(id){delete p.channels[id];});
 if(profileId!=='guest')persistProfiles();renderPanel('eventDetails');toast(station?'Channel saved':'Channel cleared');}
function detailRow(label,value){return value?'<div class="event-detail-row"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>':'';}
function eventDetailsBody(){var e=selectedEvent;if(!e)return '<p class="calendar-empty">Event is no longer available.</p>';
 var kind=e.kind==='play'?'Playing':e.kind==='watch'?'Watching':'Life';
 var date=new Date(e.start).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
 var time=e.allDay?'All day':calendarTime(e.start,false)+' – '+calendarTime(e.end,false);
 var body='<div class="event-details">'+detailRow('TYPE',kind)+detailRow('DATE',date)+detailRow('TIME',time);
 if(e.location)body+=detailRow(e.kind==='play'?'FIELD':'LOCATION',e.location);
 if(e.kind==='watch'){
  var channel=savedChannel(e);
  body+=detailRow('DROGON TV CHANNEL',channel||'Not assigned');
  body+=row('editWatchChannel',channel?'Edit channel':'Assign Drogon TV channel','Edit','Use the exact name in your configured Perfect Player playlist');
  body+=row('openPerfectPlayer','Open Perfect Player','Open','Choose '+(channel||'the match channel')+' in your playlist');
 }
 if(e.description)body+='<div class="event-details-copy"><span>NOTES</span><p>'+esc(e.description)+'</p></div>';
 if(e.url)body+='<div class="event-details-copy"><span>EVENT LINK</span><p>'+esc(e.url)+'</p></div>';
 return body+'</div>';}
function recentApps(){var p=currentProfile();return p&&Array.isArray(p.recent)?p.recent.map(byId).filter(Boolean):[];}
function rememberApp(id){if(!byId(id))return;var p=currentProfile();if(!p)return;
 p.recent=[id].concat((p.recent||[]).filter(function(x){return x!==id&&!!byId(x);})).slice(0,recentMax);
 var now=Date.now(),cutoff=now-91*86400000;
 p.usage=(Array.isArray(p.usage)?p.usage:[]).filter(function(v){return v&&v.at>=cutoff&&v.at<=now;}).slice(-749);
 p.usage.push({id:id,at:now});
 if(profileId!=='guest')persistProfiles();}
function sortLabel(){var mode=currentProfile().appSort||'name';
 return {name:'Name A–Z',recent:'Last opened',week:'Most opened · 7 days',month:'Most opened · 30 days',quarter:'Most opened · 90 days'}[mode]||'Name A–Z';}
function orderedApps(){
 var sorted=apps.slice(),p=currentProfile(),mode=p.appSort||'name',counts={},latest={},now=Date.now();
 var limit=mode==='week'?7:mode==='month'?30:mode==='quarter'?90:90;
 (p.usage||[]).forEach(function(v){if(v.at<now-limit*86400000||v.at>now)return;
  counts[v.id]=(counts[v.id]||0)+1;latest[v.id]=Math.max(latest[v.id]||0,v.at);
 });
 var recentOrder={};(p.recent||[]).forEach(function(id,i){recentOrder[id]=i;});
 sorted.sort(function(a,b){
  if(mode==='recent'){
   var ar=Object.prototype.hasOwnProperty.call(recentOrder,a.id)?recentOrder[a.id]:9999,
       br=Object.prototype.hasOwnProperty.call(recentOrder,b.id)?recentOrder[b.id]:9999;
   if(ar!==br)return ar-br;
  }else if(mode!=='name'){
   var diff=(counts[b.id]||0)-(counts[a.id]||0);if(diff)return diff;
   diff=(latest[b.id]||0)-(latest[a.id]||0);if(diff)return diff;
  }
  return a.name.localeCompare(b.name);
 });return sorted;
}
function openAppMenu(id){if(!byId(id))return;contextAppId=id;contextFrom=screen==='all'?'all':screen==='recent'?'recent':'';navigatePanel('appMenu');}
function recentPanel(){var rows=recentApps();return rows.length?'<div class="app-grid">'+rows.map(function(a){return tile(a,'launch');}).join('')+'</div><p class="library-footnote">Only apps launched through Vela are listed. Each saved profile has its own history.</p>':'<p class="library-footnote">Apps you open from Vela will appear here. Nothing is tracked in Netflix or YouTube.</p>';}

function favoritesEditor(){var b='<div class="editor-heading"><span>HOME APPS</span><small>Use arrows to reorder · max 8</small></div><div class="favorite-editor">';
 fav.forEach(function(id,i){var a=byId(id);if(!a)return;b+='<div class="favorite-inline" data-id="'+esc(id)+'">'+icon(a)+'<span class="favorite-title">'+esc(a.name)+'</span>'+
 '<button class="edit-arrow focusable" data-act="swap" data-dir="-1" data-id="'+esc(id)+'" aria-label="Move '+esc(a.name)+' left" '+(i===0?'disabled':'')+'>‹</button>'+
 '<button class="edit-arrow focusable" data-act="swap" data-dir="1" data-id="'+esc(id)+'" aria-label="Move '+esc(a.name)+' right" '+(i===fav.length-1?'disabled':'')+'>›</button>'+
 '<button class="edit-remove focusable" data-act="remove" data-id="'+esc(id)+'" aria-label="Remove '+esc(a.name)+'">−</button></div>';});
 b+='</div><div class="editor-heading"><span>ADD APPS</span><small>Select + to pin</small></div><div class="add-list">';
 apps.forEach(function(a){if(fav.indexOf(a.id)<0)b+='<button class="add-app focusable" data-act="add" data-id="'+esc(a.id)+'" aria-label="Add '+esc(a.name)+'"><span class="add-sign">+</span>'+esc(a.name)+'</button>';});
 b+='</div>';return b;}
function renderPanel(type,focusKey,retainScroll){hideUpcomingReminder();var host=$('#panelContent'),scrollTop=retainScroll?host.scrollTop:0;
 screen=type;if(rotationTimer){clearTimeout(rotationTimer);rotationTimer=null;}$('#overlay').classList.remove('hidden');$('#overlay').classList.toggle('catalog',type==='all');$('#overlay').classList.toggle('profile-panel',type==='profiles');$('#overlay').classList.toggle('wallpaper-panel',type==='wallpapers');$('#overlay').classList.toggle('pairing-panel',type==='pairing');$('#overlay').classList.toggle('startup-panel',type==='startupProfiles');$('#focusLabel').classList.remove('visible');
 var title='',subtitle='',body='';
 if(type==='settings'){title='Settings';subtitle='Four simple sections.';
 body=row('homeSettings','Home & Profiles','Open','Appearance, favorites and profile selection')+
 row('lifeSettings','Daily Life','Open',tizenMode?'Private calendar':'Calendar, screensaver and baby monitor')+
 row('appsSettings','Apps & Activity','Open','Browse and sort installed apps')+
 row('deviceSettings','Device & Support','Open','Updates, recovery and about');}
 else if(type==='homeSettings'){title='Home & Profiles';subtitle='Personalize the Vela Home experience.';
 body=row('customize','Appearance','Open','Theme, wallpapers and clock')+
 row('homeApps','Home favorites','Edit','Add and arrange pinned apps')+
 row('profiles','Profiles',currentProfile().name,'Manage profiles')+
 row('wakeProfileToggle',tizenMode?'Ask for profile on Vela launch':'Ask for profile on TV wake',bridge&&bridge.wakeProfilePromptEnabled&&!bridge.wakeProfilePromptEnabled()?'Off':'On',tizenMode?'When you open Vela; Samsung controls TV startup':'After standby; not when returning from a streaming app');}
 else if(type==='lifeSettings'){title='Daily Life';subtitle='Small conveniences, no Home clutter.';
 body=row('calendarSettings','Calendar',calVerified?'Verified':calConnected?'Saved':'Connect','Today events and subscriptions')+
 (tizenMode?'':row('screensaverSettingsPanel','Screensaver','Open','Moving clock and current events')+
 row('monitorSettings','Baby monitor',monitorEnabled?'Visible':'Hidden','Optional camera shortcut'));}
 else if(type==='screensaverSettingsPanel'){title='Screensaver';subtitle='Vela Clock moves gently and shows up to three cached events.';
 body=row('screensaver','Choose Vela Clock','Sony settings','Set Vela Clock as your preferred screensaver')+
 '<p class="library-footnote">Current and upcoming events appear from the selected profile’s verified calendar cache. No network request is made by the screensaver.</p>';}
 else if(type==='appsSettings'){title='Apps & Activity';subtitle='Your app history stays on this TV.';
 body=row('all','All installed apps',apps.length+' apps','Browse and launch apps')+
 row('recent','Recently opened',recentApps().length+' apps','Last five apps opened through Vela')+
 row('appSort','App sorting',sortLabel(),'Alphabetical, recent or most used in 7, 30 or 90 days');}
 else if(type==='appSort'){title='Sort installed apps';subtitle='Sorted per profile; Home favorites remain manually arranged.';
 body=row('chooseSort','Name A–Z',(currentProfile().appSort||'name')==='name'?'✓':'','Alphabetical order','name')+
 row('chooseSort','Recently opened',currentProfile().appSort==='recent'?'✓':'','Most recently opened first','recent')+
 row('chooseSort','Most opened · 7 days',currentProfile().appSort==='week'?'✓':'','Last week','week')+
 row('chooseSort','Most opened · 30 days',currentProfile().appSort==='month'?'✓':'','Last month','month')+
 row('chooseSort','Most opened · 90 days',currentProfile().appSort==='quarter'?'✓':'','Last three months','quarter');}
 else if(type==='deviceSettings'){title='Device & Support';subtitle='System controls in one place.';
 body=tizenMode?row('samsungHome','Samsung Home','Open','Return to the native Samsung interface')+
 row('samsungSettings','TV settings','Open','Open Samsung settings if supported')+
 row('about','About Vela on Samsung','Info','Tizen capabilities and privacy'):
 row('remoteSettings','Web remote',bridge&&bridge.remoteEnabled&&bridge.remoteEnabled()?'Enabled':'Set up','Secure remote control from your phone')+
 row('updates','Software updates','Open','Download and approve Vela updates')+
 row('recovery','Recovery','Open','Return to Sony Home and restore controls')+
 row('about','About Vela','Info','Version and privacy');
 }
 else if(type==='remoteSettings'){title='Web Remote';subtitle='Use your phone at vudh1.github.io/velatv/remote.';
 var paired=bridge&&bridge.remotePairedCount?bridge.remotePairedCount():-1;
 var pairingLabel=paired<0?'Checking phones…':paired===1?'1 phone paired':paired+' phones paired';
 body=(bridge&&bridge.remoteRevocationPending&&bridge.remoteRevocationPending()?row('remoteDisable','Retry Revocation','Pending','The TV is paused until Cloudflare confirms removal'):
 bridge&&bridge.remoteEnabled&&bridge.remoteEnabled()?
 '<div class="version-meta" id="remotePairedStatus">'+esc(pairingLabel)+'</div>'+
 row('remoteRotate','Add Another Remote','Generate PIN','Pair another phone without disconnecting existing remotes (up to 4)')+
 row('remoteDisable',paired>0?'Disconnect All Phones':'Turn Off Web Remote',paired>0?'Revoke':'Turn Off',paired>0?'Revoke all paired phones and remove this TV enrollment':'Remove this TV enrollment; no phones are paired'):
 row('remotePair','Enable Remote','Generate PIN','Generate a new private 10-digit PIN on this TV'))+
 row('remoteAccessibility','Control other apps','Sony settings','Optional accessibility service; app compatibility varies')+
 row('sonyIpSetup','Sony native-app controls',bridge&&bridge.sonyIpControlEnabled&&bridge.sonyIpControlEnabled()?'Connected':'Set up','Optional IP control for Netflix/YouTube navigation; key stays on the TV')+
 (bridge&&bridge.sonyIpControlEnabled&&bridge.sonyIpControlEnabled()?
 row('sonyIpTest','Test Sony controls','Test','Send one Up command to check Sony IP control')+
 row('sonyIpRemove','Remove Sony key','Remove','Delete the encrypted Sony control key from this TV'):'')+
 '<p class="library-footnote">Generate a separate one-time PIN for each phone (up to four). Existing paired remotes remain connected; each reconnects privately after idle. All devices must share the home Internet connection. Disconnect on a phone removes only that phone; Disable remote resets all phones.</p>';
 }
 else if(type==='about'){title='About Vela';subtitle='A calmer TV launcher.';
 body=tizenMode?
 '<p class="library-footnote">Samsung Tizen build. Profiles, favorites and app history stay on this TV. Private iCal subscriptions and cached events use AES-GCM with a Samsung KeyManager-protected key. Samsung owns the system screensaver and power-on interface; Vela opens as an app. A Samsung device certificate is required for installation. Automatic WGT updates are not yet available. Weather: Open-Meteo (CC BY 4.0), approximate location by IP Info.</p>':
 '<p class="library-footnote">Version: '+esc(updateStatus&&updateStatus.current?updateStatus.current:'See Updates')+'</p>'+
 '<p class="library-footnote">Profiles and app activity stay on this TV. Calendar links and events are stored locally with Android Keystore encryption. Returning to Sony Home remains available under Recovery. Weather: Open-Meteo (CC BY 4.0), approximate location by IP Info.</p>';}
 else if(type==='homeApps'){title='Home favorites';subtitle='Pin up to eight apps and reorder with arrows.';body=favoritesEditor();}
 else if(type==='startupProfiles'){title="Who's Watching?";subtitle='Choose your space.';
 body='<div class="startup-avatar-grid" style="--selector-columns:'+Math.min(profiles.length,4)+'" role="group" aria-label="Choose your profile">'+profiles.map(function(p){
 return '<button class="startup-avatar-card focusable" data-act="switchProfile" data-id="'+esc(p.id)+'" aria-label="Continue as '+esc(p.name)+'"><span class="startup-avatar" data-avatar="'+esc(p.avatar)+'">'+avatarSvg(p.avatar,p.name)+'</span><span class="startup-profile-name">'+esc(p.name)+'</span></button>';
 }).join('')+'</div><p class="startup-footer">SELECT A PROFILE TO CONTINUE</p>';}
 else if(type==='all'){title='All apps';subtitle='Hold OK on an icon for quick actions.';
 body='<div class="app-grid">'+orderedApps().map(function(a){return tile(a,'launch');}).join('')+'</div>'+(apps.length?'<p class="library-footnote">Sorted by '+esc(sortLabel())+' · Change under Gear → Apps</p>':'<p>Loading installed apps…</p>');}
 else if(type==='recent'){title='Recently opened';subtitle='Just your last five Vela launches, on this profile.';body=recentPanel();}
 else if(type==='appMenu'){var app=byId(contextAppId),pinned=fav.indexOf(contextAppId)>=0;title=app?app.name:'App actions';subtitle='Hold OK on an app to open these quick actions.';
 body=app?'<div class="context-app">'+icon(app)+'<span>'+esc(app.name)+'</span></div>'+appRow('launch','Open app','Open','Launch this application',contextAppId)+appRow('togglePin',pinned?'Remove from Home':'Add to Home',pinned?'Unpin':'Pin',pinned?'Keep in All apps':'Show in your favorites dock',contextAppId)+(tizenMode?'':appRow('appInfo','App information','Settings','Open the Android app settings for this app',contextAppId)):'<p>App no longer installed.</p>';}

 else if(type==='customize'){title='Personalize';subtitle='Changes appear behind this panel immediately.';
 body=(tizenMode?'':row('volumeSettings','Volume indicator',volumeMode==='off'?'Native only':volumeMode==='glass'?'Glass':'Minimal','Sony native by default; optional custom preview'))+row('layout','Home layout',mode==='dock'?'Dock':'List','Switch between dock and list')+row('appLabels','App labels',appLabelMode==='focus'?'On focus':appLabelMode==='both'?'Icon + name':'Name only','Cycle three clean launcher styles')+row('theme','Contrast',theme==='dark'?'Dark':'Light','Match your wallpaper')+row('wallpapers','Wallpaper library',wallpapers[parseInt(scenery,10)||0].name,'Browse eight bundled backgrounds')+row('rotate','Wallpaper rotation',rotationMinutes?'Every 30 min':'Off','Only rotates while Home is visible')+row('font','Clock type',fontStyle==='modern'?'Modern':'Classic','Change the clock font without extra downloads')+row('clockFormat','Time format',clockFormat==='auto'?'TV setting':clockFormat==='24'?'24-hour':'12-hour','Use TV setting when available')+(tizenMode?'':row('photo','Custom photo','Choose','Use a picture stored on this TV')+row('resetPhoto','Reset photo','Restore','Return to the selected built-in wallpaper'));}
 else if(type==='volumeSettings'){title='Volume overlay';subtitle='Experimental Home-only overlay. Streaming apps continue using Sony’s native volume controls.';
 body=row('volumeStyle','Appearance',volumeMode==='glass'?'Glass':volumeMode==='minimal'?'Minimal':'Native only','Switch Glass → Minimal → Native only')+
 row('volumePercent','Show percentage',volumePercent?'On':'Off','Bar only is the cleanest look')+
 row('volumePosition','Position',volumePosition==='center'?'Bottom center':'Bottom right','Keep it away from the clock')+
 row('volumeDelay','Hide delay',volumeDelay===800?'Short · 0.8 s':'Normal · 1.2 s','Automatically disappears after input')+
 row('volumeDemo','Preview Vela overlay','Play','Works in Native only mode; does not change TV audio')+
 '<p class="library-footnote">'+esc(bridge&&bridge.volumeSupportMessage?bridge.volumeSupportMessage():'On some TVs, the OEM intercepts remote volume keys before Vela. The Preview overlay is always available; it does not change system audio.')+'</p>';
 }
 else if(type==='wallpapers'){title='Wallpapers';subtitle='Select to preview immediately on Home.';body=wallpaperGallery();}
 else if(type==='profiles'){title='Profiles';subtitle='Separate favorite apps, layouts and wallpapers.';body=profileChooser();}
 else if(type==='avatars'){title='Profile icons';subtitle='Choose a symbol for '+((profiles.filter(function(p){return p.id===editingAvatar;})[0]||{}).name||'profile')+'.';body=avatarPicker();}
 else if(type==='monitorSettings'){title='Baby monitor';subtitle='Optional camera shortcut for '+currentProfile().name+'.';
 body=row('monitorToggle','Show camera button',monitorEnabled?'On':'Off','Places the camera icon beside Calendar and Settings')+
 '<div class="monitor-state"><strong>Nanit first</strong><span>Open Nanit’s official web viewer. Your Nanit credentials are entered only in the browser, not stored by Vela. It requires an eligible Nanit Insights plan and Owner/Admin access.</span></div>'+
 row('nanitWeb','Open Nanit web viewer','Open','Uses your TV browser · my.nanit.com')+
 row('cameraApps','Other camera apps','Browse','Open a compatible baby-camera or IP-camera app')+
 '<p class="monitor-detail">Your Sony Google TV runs Android 12, which does not provide reliable cross-app TV picture-in-picture. The camera cannot float over built-in Netflix or YouTube using this method. No camera stream runs while the monitor panel is closed.</p>';
 }
 else if(type==='monitor'){title='Baby monitor';subtitle='Quickly open a camera feed.';
 body='<div class="monitor-state"><strong>Nanit</strong><span>Official live web viewer for eligible Nanit accounts. The feed will open separately from Vela, not float over Netflix or YouTube.</span></div>'+
 row('nanitWeb','View Nanit camera','Open','Open my.nanit.com in your TV browser')+
 row('cameraApps','Other camera apps','Browse','Choose a TV-installed camera or network monitor app')+
 row('monitorSettings','Monitor settings','Edit','Show/hide this button and read PiP compatibility');
 }
 else if(type==='calendar'){title='Calendar';subtitle=calConnected?'Upcoming events for '+currentProfile().name:'Connect Google and BallerWatch under Gear → Calendar.';
 body=calendarEventList();}
 else if(type==='calendarSettings'){title='Calendar · '+currentProfile().name;subtitle='Private read-only iCal subscription, not Google sign-in.';
 var stamp=calLastSuccess?new Date(calLastSuccess).toLocaleString():'Never';var badge=calVerified?'VERIFIED':calConnected?'NOT VERIFIED':'NOT CONNECTED';
 body='<div class="calendar-connection"><span class="connection-pill '+(calVerified?'verified':calConnected?'pending':'')+'">'+badge+'</span>'+
 '<div class="connection-name">'+esc(calSources.length?calSources.map(function(s){return s.kind==='sport'?'BallerWatch':'Google';}).join(' + '):'No calendar selected')+'</div>'+
 '<div class="connection-detail">'+esc(calStatus||'No refresh attempted')+'</div><div class="connection-detail">Last successful sync: '+esc(stamp)+'</div></div>';
 if(profileId==='guest')body+='<p class="calendar-help">Guest is temporary: no calendar addresses or events are saved.</p>';
 else body+=row('calendarSource','Google Calendar',calSources.some(function(s){return s.kind==='google';})?'Connected':'Connect','Birthdays, appointments, tasks and other events','google')+
 row('calendarSource','BallerWatch',calSources.some(function(s){return s.kind==='sport';})?'Connected':'Connect','Matches you play and professional sports you watch','sport')+
 row('refreshCalendar','Refresh now','↻','Fetch new games from the saved links; normally every 15 minutes')+
  (calConnected?row('disconnectCalendar','Disconnect both calendars','Remove','Delete both subscriptions and caches for this profile'):'')+
 '<p class="library-footnote">Both feeds are read-only and encrypted separately. Each can be replaced without removing the other. '+(tizenMode?'Samsung requires direct HTTPS access from this TV; no proxy receives your private link.':'Only use private iCal addresses on a trusted device.')+'</p>';
 }
 else if(type==='calendarSource'){var isSport=selectedSource==='sport',attached=calSources.some(function(s){return s.kind===selectedSource;});
 title=isSport?'BallerWatch sports':'Google Calendar';subtitle=isSport?'Your playing and watched sports fixtures.':'Your birthdays, reminders, appointments and tasks.';
 body=(tizenMode?row('tizenCalendarEntry',attached?'Replace subscription':'Connect subscription','Enter','Paste the private read-only iCal URL'):
 row('pairCalendar','Connect using phone','QR','Scan on your trusted Wi-Fi and paste the subscription URL')+
 row('connectCalendar',attached?'Replace on TV':'Enter on TV','Enter','Paste the iCal URL on your Sony TV'))+
 (attached?row('removeCalendarSource','Remove this source','Remove','Keep the other calendar connected'):'')+
 '<p class="library-footnote">'+(isSport?'Copy the feed under BallerWatch → Settings → Share my calendar. Newly published games for selected teams update automatically. Changing your monitored teams currently creates a different link; replace this source once after a watchlist change.':'Get your secret iCal link from Google Calendar settings. You do not need to sign into Google on this TV.')+'</p>';}
 else if(type==='tizenCalendarEntry'){title='Private calendar';subtitle='Samsung · saved under this profile only';
 body='<p class="library-footnote">Paste your '+(selectedSource==='sport'?'BallerWatch sports':'Google Calendar secret')+' iCal address using the Samsung keyboard or SmartThings remote. Press Down after editing to reach Save. Vela encrypts the link before saving.</p>'+
 '<label class="calendar-input-label" for="tizenCalendarUrl">Secret HTTPS iCal URL</label>'+
 '<input class="calendar-url-input" id="tizenCalendarUrl" type="url" inputmode="url" maxlength="4096" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="'+(selectedSource==='sport'?'https://ballerwatch-web.vudhone.workers.dev/web/calendar.ics':'https://calendar.google.com/calendar/ical/…/basic.ics')+'">'+
 row('focusCalendarInput','Enter or paste calendar address','Edit','Opens the Samsung keyboard')+
 row('saveTizenCalendar','Save and verify','Save','Encrypt locally and check today’s events')+
 '<p class="library-footnote">Only approved direct HTTPS feeds are accepted. The TV stores no Google login or IPTV credentials.</p>';}
 else if(type==='eventDetails'){title=selectedEvent?selectedEvent.title:'Event details';subtitle='Full context stays here, away from Home and screensaver.';
 body=eventDetailsBody();}
 else if(type==='watchChannelEditor'){title='Drogon TV channel';subtitle='Just a display name for this watched match.';
 body='<p class="library-footnote">Enter the channel name exactly as it appears in your own Perfect Player playlist. This does not access IPTV credentials or the playlist.</p>'+
 '<label class="calendar-input-label" for="eventChannelName">Channel name</label>'+
 '<input class="calendar-url-input" id="eventChannelName" maxlength="80" autocomplete="off" placeholder="e.g. USA Network HD" value="'+esc(savedChannel(selectedEvent))+'">'+
 row('focusChannelInput','Edit channel name','Edit','Open the Samsung keyboard')+
 row('saveWatchChannel','Save channel','Save','Show this channel in the event details');}
 else if(type==='pairing'){title='Connect using phone';subtitle='Scan QR on the same home Wi-Fi.';
 body='<div class="pair-stage"><div class="pair-qr" id="pairQr">'+(pairingUrl?qrSvg(pairingUrl):'<span class="pair-loading">'+(pairingExpiresAt?'Pairing expired — generate a new code':'Starting local pairing…')+'</span>')+'</div>'+
  '<p class="pair-countdown" id="pairCountdown" aria-live="off"></p>'+
  '<p class="pair-url">'+esc(pairingUrl||'')+'</p>'+
  '<p class="pair-help">Scan with your phone on the same private home Wi-Fi. This single-use QR expires after 10 minutes. Enter the private iCal address only on your phone.</p></div>'+
  row('renewPair','Generate new QR','↻','Refresh an expired or unscannable code')+
  row('cancelPair','Cancel pairing','Close','Close the phone connection immediately');
 }
 else if(type==='recovery'){title='About & Recovery';subtitle='The original launcher stays installed and available.';var redirected=false;try{redirected=bridge?bridge.redirectEnabled():false;}catch(e){}
 body='<p class="library-footnote">Try pressing Home twice quickly to show original Sony Home. This shortcut depends on Sony firmware and may not work. You can always use Open Sony Home below.</p>'+row('sony','Open Sony Home','Open','Temporarily pauses redirect')+row('redirect','Home redirect',redirected?'On':'Off','Accessibility override')+row('accessibility','Accessibility service','Open','Recovery if Home shortcut fails');}
 else if(type==='updates'){title='Updates';subtitle='Check, download and approve new Vela versions.';var s=updateStatus;
 body='<div class="version-meta">'+esc(s&&s.current?'Installed: '+s.current:'Installed version: unknown')+'</div>'+
 '<div class="version-meta">'+esc(s&&s.status?s.status:'Open Check for updates to retrieve the latest release.')+'</div>'+
 row('checkUpdates','Check now','Check','Check GitHub Releases for the newest signed APK')+
 (s&&s.available?row('installUpdate',s.downloaded?'Open Android installer':'Download & install',s.downloaded?'Install':'Download','Opens the Sony package installer for your approval'):'')+
 (s&&s.available&&s.downloaded?row('installUpdateSession','Alternative installer','Retry','If the first installer does not appear, try the Android session method'):'')+
 row('autoUpdates','Automatic daily checks',s&&s.auto===false?'Off':'On','Check when Vela is open, once per day')+
 row('autoDownload','Download updates automatically',s&&s.autoDownload===false?'Off':'On','Save and SHA-256 verify new APKs in the background; installation requires approval');}
 $('#panelTitle').textContent=(type==='appMenu'||type==='calendarSettings')?title:uiTitle(title);$('#panelDescription').textContent=subtitle;host.innerHTML=body;host.scrollTop=scrollTop;
 listDirty=true;activeList();var focusIndex=0;if(focusKey){for(var i=0;i<controls.length;i++){var b=controls[i];if(b.getAttribute('data-act')===focusKey.act&&(focusKey.id===undefined||b.getAttribute('data-id')===focusKey.id)&&(!focusKey.dir||b.getAttribute('data-dir')===focusKey.dir)){focusIndex=i;break;}}}
 if(type==='calendar')lastCalendarMarkup=body;else lastCalendarMarkup='';
 if(!focusKey){focusIndex=type==='pairing'?0:controls.findIndex(function(b){return b.getAttribute('data-act')!=='close';});if(focusIndex<0)focusIndex=0;}select(focusIndex);if(type==='pairing')pairingTick();
 if(type==='customize'||type==='all')visibleIcons();}
// Remember the control and scroll position that opened a nested group. Returning
// with Back or Left should never send the viewer to the top of Settings.
function navigatePanel(type){if(screen&&screen!==type)panelHistory.push({screen:screen,
 focus:focusedControl?{act:focusedControl.getAttribute('data-act'),id:focusedControl.getAttribute('data-id')||undefined,dir:focusedControl.getAttribute('data-dir')||undefined}:null,
 scroll:$('#panelContent').scrollTop});renderPanel(type);}
function openProfileSelector(){if(startupChooserOpen)return;panelHistory=[];renderPanel('startupProfiles');}
function checkWakeProfilePrompt(){
 if(startupChooserOpen||document.hidden||!bridge||!bridge.consumeWakeProfilePrompt)return;
 try{if(bridge.consumeWakeProfilePrompt()){
  if(screen==='pairing'&&bridge.cancelCalendarPair)bridge.cancelCalendarPair();
  startupChooserOpen=true;panelHistory=[];renderPanel('startupProfiles');
 }}catch(e){}
}
function close(){if(startupChooserOpen&&screen==='startupProfiles')return;panelHistory=[];startupChooserOpen=false;if(screen==='pairing'){stopPairClock();pairingUrl='';pairingExpiresAt=0;if(bridge&&bridge.cancelCalendarPair)bridge.cancelCalendarPair();}screen='';scheduleRotation();$('#overlay').classList.add('hidden');listDirty=true;activeList();select(Math.max(0,controls.findIndex(function(el){return el.classList.contains('app-card');})));maybeShowUpcomingReminder();}
function rerenderWithFocus(act,id,dir){renderPanel(screen,{act:act,id:id,dir:dir},true);}
function requestProfileEdit(kind,id){var p=null;for(var i=0;i<profiles.length;i++)if(profiles[i].id===id)p=profiles[i];
 var old=p?p.name:'';if(bridge&&bridge.editProfile){bridge.editProfile(kind,id,old);}else{
  var response=window.prompt(kind==='rename'?'Rename profile':'New profile name',old);if(response!==null)profileNameReady(kind,id,response);}}
function requestProfileDeletion(id){if(profiles.length<2){toast('Keep at least one profile');return;}
 var p=null;for(var i=0;i<profiles.length;i++)if(profiles[i].id===id)p=profiles[i];if(!p)return;
 if(bridge&&bridge.confirmProfileDelete)bridge.confirmProfileDelete(id,p.name);
 else if(window.confirm('Delete '+p.name+'? This removes only Vela settings.'))profileDeleteConfirmed(id);}
function action(name,id,dir){
 if(name==='togglePin'){if(!byId(id))return;var n=fav.indexOf(id);if(n>=0)fav.splice(n,1);else if(fav.length>=8){toast('Up to eight Home apps');return;}else fav.push(id);
 persistAppearance();home();renderPanel('appMenu',{act:'togglePin',id:id});return;}
 if(name==='appInfo'){if(bridge&&bridge.openAppInfo)bridge.openAppInfo(id);else toast('Android app settings are only available on TV');return;}

 if(name==='selectProfile'){openProfileSelector();return;}
 if(name==='switchProfile'){startupChooserOpen=false;panelHistory=[];if(bridge&&bridge.cancelCalendarPair)bridge.cancelCalendarPair();if(id==='guest'){profiles=profiles.filter(function(p){return p.id!=='guest';});profiles.push(makeProfile('guest','Guest',null));}profileId=id;persistProfiles();applyProfile(true);close();if(pendingRemoteSettings){pendingRemoteSettings=false;renderPanel('settings');}return;}
 if(name==='avatarPicker'){editingAvatar=id;renderPanel('avatars');return;}
 if(name==='chooseAvatar'){var p=profiles.filter(function(x){return x.id===editingAvatar;})[0];if(p){p.avatar=id;if(p.id!=='guest')persistProfiles();applyProfile(true);}renderPanel('profiles',{act:'avatarPicker',id:editingAvatar});return;}
 if(name==='pairCalendar'){if(profileId==='guest'){toast('Guest has no saved calendar');return;}startPairing();return;}
  if(name==='renewPair'){startPairing();return;}
 if(name==='cancelPair'){stopPairClock();pairingUrl='';pairingExpiresAt=0;if(bridge&&bridge.cancelCalendarPair)bridge.cancelCalendarPair();renderPanel('calendarSettings');return;}
 if(name==='calendarSource'){selectedSource=id==='sport'?'sport':'google';navigatePanel('calendarSource');return;}
 if(name==='connectCalendar'){if(profileId==='guest'){toast('Guest has no saved calendar');return;}if(bridge&&bridge.editCalendarSource)bridge.editCalendarSource(profileId,selectedSource);else if(bridge&&bridge.editCalendar)bridge.editCalendar(profileId);else toast('Connect a calendar on your TV');return;}
 if(name==='removeCalendarSource'){if(bridge&&bridge.removeCalendarSource){bridge.removeCalendarSource(profileId,selectedSource);renderPanel('calendarSettings');}return;}
 if(name==='disconnectCalendar'){if(bridge&&bridge.removeCalendar){bridge.removeCalendar(profileId);requestCalendar(false);}return;}
 if(name==='refreshCalendar'){requestCalendar(true);toast('Refreshing calendar…');return;}
 if(name==='focusCalendarInput'){var input=$('#tizenCalendarUrl');if(input)input.focus();return;}
 if(name==='saveTizenCalendar'){var field=$('#tizenCalendarUrl'),url=field?field.value.trim():'';
  var valid=window.VelaCalendarSecurity&&window.VelaCalendarSecurity.approved(url);
  if(!valid||(selectedSource==='sport'?!/^https:\/\/ballerwatch-web\.vudhone\.workers\.dev\//i.test(url):!/^https:\/\/calendar\.google\.com\//i.test(url))){toast('Paste a valid link for this source');return;}
  if(bridge&&bridge.saveCalendar)bridge.saveCalendar(profileId,url,selectedSource==='sport'?'BallerWatch':'Google Calendar');return;}
 if(name==='samsungHome'||name==='samsungSettings'){if(bridge&&bridge[name])bridge[name]();return;}
 if(name==='remotePair'){if(bridge&&bridge.pairWebRemote)bridge.pairWebRemote();else toast('Set up on your Sony TV');return;}
 if(name==='remoteRotate'){if(bridge&&bridge.rotateWebRemotePin)bridge.rotateWebRemotePin();return;}
 if(name==='remoteDisable'){if(bridge&&bridge.disableWebRemote)bridge.disableWebRemote();return;}
 if(name==='remoteAccessibility'){if(bridge&&bridge.accessibilitySettings)bridge.accessibilitySettings();return;}
 if(name==='sonyIpSetup'){if(bridge&&bridge.configureSonyIpControl)bridge.configureSonyIpControl();return;}
 if(name==='sonyIpTest'){if(bridge&&bridge.testSonyIpControl)bridge.testSonyIpControl();return;}
 if(name==='sonyIpRemove'){if(bridge&&bridge.removeSonyIpControl)bridge.removeSonyIpControl();return;}
 if(name==='chooseSort'){var p=currentProfile();p.appSort=id;if(profileId!=='guest')persistProfiles();renderPanel('appSort',{act:'chooseSort',id:id},true);return;}
 if(name==='wakeProfileToggle'){if(bridge&&bridge.setWakeProfilePromptEnabled){bridge.setWakeProfilePromptEnabled(!bridge.wakeProfilePromptEnabled());}renderPanel('homeSettings',{act:'wakeProfileToggle'},true);return;}
 if(name==='filterCalendar'){calendarFilter=['all','play','watch','other'].indexOf(id)>=0?id:'all';renderPanel('calendar',{act:'filterCalendar',id:calendarFilter},true);return;}
 if(name==='eventInfo'){var chosen=calendarViewEvents[Number(id)];if(chosen){selectedEvent=chosen;navigatePanel('eventDetails');}return;}
 if(name==='editWatchChannel'){if(!selectedEvent||selectedEvent.kind!=='watch')return;
  if(bridge&&bridge.editWatchChannel)bridge.editWatchChannel(eventKey(selectedEvent),savedChannel(selectedEvent));
  else navigatePanel('watchChannelEditor');return;}
 if(name==='focusChannelInput'){var input=$('#eventChannelName');if(input)input.focus();return;}
 if(name==='saveWatchChannel'){var entry=$('#eventChannelName');if(entry&&selectedEvent)watchChannelReady(eventKey(selectedEvent),entry.value);return;}
 if(name==='openPerfectPlayer'){if(!selectedEvent||selectedEvent.kind!=='watch')return;
  var pp=apps.filter(function(a){return a.package==='com.niklabs.pp'||/perfect player/i.test(a.name);})[0];
  if(!pp){toast('Install or open Perfect Player from your TV apps');return;}
  rememberApp(pp.id);if(bridge&&bridge.launchApp)bridge.launchApp(pp.id);else toast('Open Perfect Player on your TV');return;}
 if(name==='addProfile'){requestProfileEdit('add','');return;}
 if(name==='renameProfile'){requestProfileEdit('rename',id);return;}
 if(name==='deleteProfile'){requestProfileDeletion(id);return;}
 if(name==='chooseWallpaper'){var num=parseInt(id,10);if(num>=0&&num<wallpapers.length){scenery=String(num);if(customPhoto){customPhoto='';if(bridge)bridge.resetWallpaper();}persistAppearance();setScenery();rerenderWithFocus('chooseWallpaper',id);}return;}
 if(name==='rotate'){rotationMinutes=rotationMinutes?0:30;persistAppearance();scheduleRotation();rerenderWithFocus('rotate');return;}
 if(name==='appLabels'){appLabelMode=appLabelMode==='focus'?'both':appLabelMode==='both'?'names':'focus';document.body.setAttribute('data-app-labels',appLabelMode);persistAppearance();home();rerenderWithFocus('appLabels');return;}
 if(name==='font'){fontStyle=fontStyle==='modern'?'classic':'modern';document.body.classList.toggle('modern-clock',fontStyle==='modern');persistAppearance();rerenderWithFocus('font');return;}
 if(name==='clockFormat'){clockFormat=clockFormat==='auto'?'12':clockFormat==='12'?'24':'auto';clockValue='';clock();persistAppearance();rerenderWithFocus('clockFormat');return;}
 if(name==='launch'){rememberApp(id);if(preview){toast('App launch is available on your TV.');return;}if(bridge)bridge.launchApp(id);return;}
 if(['settings','homeSettings','lifeSettings','appsSettings','deviceSettings','remoteSettings','about','appSort','homeApps','screensaverSettingsPanel','all','customize','recovery','updates','profiles','wallpapers','calendar','calendarSettings','tizenCalendarEntry','monitor','monitorSettings','volumeSettings','recent'].indexOf(name)>=0){navigatePanel(name);if(name==='updates'&&bridge&&bridge.updateStatus)bridge.updateStatus();return;}
 if(name==='monitorToggle'){monitorEnabled=!monitorEnabled;$('#monitorButton').classList.toggle('hidden',!monitorEnabled);persistAppearance();renderPanel('monitorSettings',{act:'monitorToggle'},true);return;}
 if(name==='nanitWeb'){if(bridge&&bridge.openNanitWeb)bridge.openNanitWeb();else toast('Open https://my.nanit.com in your TV browser');return;}
 if(name==='cameraApps'){navigatePanel('all');return;}
 if(name==='close'){close();return;}
 if(name==='layout'){mode=mode==='dock'?'list':'dock';persistAppearance();home();rerenderWithFocus('layout');return;}
 if(name==='volumeStyle'){volumeMode=volumeMode==='glass'?'minimal':volumeMode==='minimal'?'off':'glass';saveVolumePrefs();rerenderWithFocus('volumeStyle');return;}
 if(name==='volumePercent'){volumePercent=!volumePercent;saveVolumePrefs();rerenderWithFocus('volumePercent');return;}
 if(name==='volumePosition'){volumePosition=volumePosition==='center'?'right':'center';saveVolumePrefs();rerenderWithFocus('volumePosition');return;}
 if(name==='volumeDelay'){volumeDelay=volumeDelay===1200?800:1200;saveVolumePrefs();rerenderWithFocus('volumeDelay');return;}
 if(name==='volumeDemo'){volumeChanged(lastVolume,true);return;}
 if(name==='theme'){theme=theme==='dark'?'light':'dark';persistAppearance();document.body.classList.toggle('light',theme==='light');rerenderWithFocus('theme');return;}
 if(name==='scenery'){scenery=String((parseInt(scenery,10)+1)%wallpapers.length);persistAppearance();setScenery();rerenderWithFocus('scenery');return;}
 if(name==='swap'){var n=fav.indexOf(id),to=n+parseInt(dir||'0',10);if(n>=0&&to>=0&&to<fav.length){fav.splice(n,1);fav.splice(to,0,id);persistAppearance();home();rerenderWithFocus('swap',id,dir);}return;}
 if(name==='remove'||name==='add'){var p=fav.indexOf(id);if(name==='remove'&&p>=0)fav.splice(p,1);else if(name==='add'&&p===-1){if(fav.length>=8){toast('Up to eight Home apps');return;}fav.push(id);}persistAppearance();home();rerenderWithFocus(name==='add'?'add':'remove',id);return;}
 if(name==='photo'){if(profileId==='guest'){toast('Custom photo is unavailable in Guest');return;}if(bridge)bridge.chooseWallpaper();else toast('Choose a photo on your TV');return;}
 if(name==='resetPhoto'){if(bridge)bridge.resetWallpaper();wallpaperReady('');toast('Built-in background restored');return;}
 if(name==='sony'){if(bridge)bridge.sonyHome();else toast('Sony Home opens on your TV');return;}
 if(name==='system'){if(bridge)bridge.systemSettings();else toast('Only on Android TV');return;}
 if(name==='screensaver'){if(bridge)bridge.screensaverSettings();else toast('Set Vela Clock in TV settings');return;}
 if(name==='accessibility'){if(bridge)bridge.accessibilitySettings();return;}
 if(name==='choosehome'){if(bridge)bridge.homeSettings();return;}
 if(name==='redirect'){if(bridge){bridge.setRedirect(!bridge.redirectEnabled());rerenderWithFocus('redirect');}return;}
 if(name==='checkUpdates'){if(bridge&&bridge.checkUpdates)bridge.checkUpdates();else toast('Publish your GitHub release first');return;}
 if(name==='installUpdate'){if(bridge&&bridge.installUpdate)bridge.installUpdate();return;}
 if(name==='installUpdateSession'){if(bridge&&bridge.installUpdateSession)bridge.installUpdateSession();return;}
 if(name==='autoUpdates'){if(bridge&&bridge.setAutoUpdates){bridge.setAutoUpdates(!!updateStatus&&!updateStatus.auto);renderPanel('updates',{act:'autoUpdates'},true);}return;}
 if(name==='autoDownload'){if(bridge&&bridge.setAutoDownload){bridge.setAutoDownload(!!updateStatus&&!updateStatus.autoDownload);renderPanel('updates',{act:'autoDownload'},true);}return;}
}
function trigger(){activeList();var b=controls[cursor];if(b)action(b.getAttribute('data-act'),b.getAttribute('data-id')||'',b.getAttribute('data-dir')||'');}
function goBack(){
 if(!screen)return;
 if(screen==='startupProfiles'&&startupChooserOpen)return;
 if(screen==='pairing'){stopPairClock();pairingUrl='';pairingExpiresAt=0;
  if(bridge&&bridge.cancelCalendarPair)bridge.cancelCalendarPair();}
 if(panelHistory.length){var previous=panelHistory.pop();renderPanel(previous.screen,previous.focus);
  $('#panelContent').scrollTop=previous.scroll;listDirty=true;return;}
 close();
}
function remote(key){
 if(key==='settings'){
  if(startupChooserOpen&&screen==='startupProfiles'){pendingRemoteSettings=true;return;}
  panelHistory=[];renderPanel('settings');return;
 }
 if(key==='home'){close();return;}
 if(key==='longselect'){activeList();var chosen=controls[cursor];if(chosen&&chosen.classList.contains('app-card'))openAppMenu(chosen.getAttribute('data-id'));return;}
 if(key==='back'){goBack();return;}
 if(key==='select'){trigger();return;}
 activeList();if(!controls.length)return;
 var c=geometry[cursor],best=-1,score=Infinity;if(!c)return;
 for(var i=0;i<geometry.length;i++){if(i===cursor)continue;var r=geometry[i],dx=r.x-c.x,dy=r.y-c.y;
  if((key==='left'&&dx>=-6)||(key==='right'&&dx<=6)||(key==='up'&&dy>=-6)||(key==='down'&&dy<=6))continue;
  var major=(key==='left'||key==='right')?Math.abs(dx):Math.abs(dy),minor=(key==='left'||key==='right')?Math.abs(dy):Math.abs(dx),candidate=major+minor*3.0;
  if(candidate<score){score=candidate;best=i;}
 }
 if(best>=0)select(best);
 else if(key==='left'&&screen)goBack();
}
// De-duplicate the same public fixture arriving through Google and BallerWatch
// even when the two providers assign different UIDs. Location is deliberately
// part of the identity: similarly named games at distinct fields remain separate.
function dedupeCalendarEvents(items){var seen=Object.create(null);return items.filter(function(e){
 var title=String(e.title||'').trim().replace(/\s+/g,' ').toLowerCase();
 var location=String(e.location||'').trim().replace(/\s+/g,' ').toLowerCase();
 var key=[Number(e.start),Number(e.end),e.kind||'other',title,location].join('|');
 if(seen[key])return false;seen[key]=true;return true;
});}
function calendarTime(ms,allDay){if(allDay)return 'All day';var d=new Date(ms);return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
function calendarDate(ms){return new Date(ms).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function calendarState(e){if(e.allDay)return '';var n=Date.now();return e.start<=n&&e.end>n?'ongoing':e.start>n&&e.start<=n+3600000?'soon':e.start>n&&e.start<=n+2*3600000?'later':'';}
function calendarToday(){var now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
 var end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime();
 return calEvents.filter(function(e){return Number(e.start)<end&&Number(e.end)>Math.max(start,Date.now());}).sort(function(a,b){return a.start-b.start;});}
function calendarUpcoming(){var now=Date.now(),d=new Date(now),lastNextDay=new Date(d.getFullYear(),d.getMonth()+2,0).getDate();
 var until=new Date(d.getFullYear(),d.getMonth()+1,Math.min(d.getDate(),lastNextDay),d.getHours(),d.getMinutes(),d.getSeconds()).getTime();
 return calEvents.filter(function(e){return e.end>now&&e.start<until&&(calendarFilter==='all'||(e.kind||'other')===calendarFilter);}).sort(function(a,b){return a.start-b.start;});}
function calendarDayDivider(e,previous){var now=new Date(),day=new Date(Math.max(e.start,Date.now()));
 var key=[day.getFullYear(),day.getMonth(),day.getDate()].join('-');if(key===previous)return '';
 var today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
 var dayStart=new Date(day.getFullYear(),day.getMonth(),day.getDate()).getTime();
 var heading=dayStart===today?'Today':dayStart===new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()?'Tomorrow':
 day.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
 return '<div class="event-day-divider" aria-label="'+esc(heading)+'"><span>'+esc(heading)+'</span></div>';}
function eventHTML(e,compact,index){var state=calendarState(e),when=calendarDate(e.start)+' · '+calendarTime(e.start,e.allDay);
 var type=e.kind==='play'?'PLAYING · ':e.kind==='watch'?'WATCHING · ':'LIFE · ';
 var meta=(compact?(state==='ongoing'?'NOW · ':state==='soon'?'NEXT · ':'UPCOMING · '):type+(state==='ongoing'?'NOW · ':state==='soon'?'NEXT HOUR · ':''))+when;
 // Home may show a known field or user-confirmed channel, never an inferred
 // broadcaster. Descriptions and private links stay in selected-event detail.
 var p=currentProfile();var confirmed=p&&p.channels&&p.channels[eventKey(e)]||'';
 var hint=compact?(e.kind==='play'?e.location:e.kind==='watch'?confirmed:''):'';
 var content='<span class="event-meta">'+esc(meta)+'</span><span class="event-summary">'+esc(e.title||'Untitled event')+'</span>'+(compact?'':'<span class="event-when">'+esc(e.allDay?'':calendarTime(e.start,false)+' – '+calendarTime(e.end,false))+'</span>');
 if(hint)content+='<span class="event-hint">'+esc(hint)+'</span>';
 return compact?'<div class="event-item '+(state||'')+' event-peek">'+content+'</div>':
 '<button type="button" class="event-item focusable '+(state||'')+'" data-act="eventInfo" data-id="'+index+'" aria-label="'+esc((e.title||'Untitled event')+', '+meta)+'">'+content+'</button>';}
function calendarEventList(){
 if(!calConnected)return '<p class="calendar-empty">No calendar linked for this profile. Set one up in Gear → Daily life → Calendar.</p>'+
 '<div class="calendar-tools">'+row('calendarSettings','Calendar settings','Open','Connect Google Calendar or BallerWatch')+'</div>';
 var filters=[['all','All'],['play','Playing'],['watch','Watching'],['other','Life']];
 var tabs='<div class="calendar-filters">'+filters.map(function(f){return '<button class="calendar-filter focusable'+(calendarFilter===f[0]?' is-current':'')+'" data-act="filterCalendar" data-id="'+f[0]+'">'+f[1]+'</button>';}).join('')+'</div>';
 var events=calendarUpcoming();calendarViewEvents=events;
 var previousDay='';var grouped=events.map(function(e,i){var d=new Date(Math.max(e.start,Date.now())),key=[d.getFullYear(),d.getMonth(),d.getDate()].join('-');
 var divider=calendarDayDivider(e,previousDay);previousDay=key;return divider+eventHTML(e,false,i);}).join('');
 return tabs+(events.length?grouped+
 (events.length>4?'<p class="calendar-scroll-hint">↑ ↓ Browse · OK for details</p>':''):
 '<p class="calendar-empty">No '+(calendarFilter==='all'?'upcoming':calendarFilter==='play'?'playing':calendarFilter==='watch'?'watching':'life')+' events in the next month.</p>');
}
function hideUpcomingReminder(){if(reminderTimer)clearTimeout(reminderTimer);reminderTimer=null;var el=$('#eventReminder');
 if(el){el.classList.remove('visible');el.setAttribute('aria-hidden','true');}}
function maybeShowUpcomingReminder(){
 if(screen||document.hidden||reminderTimer||!calConnected||!calVerified||profileId==='guest')return;
 var now=Date.now(),next=calendarToday().filter(function(e){
  var delta=Number(e.start)-now;return !e.allDay&&delta>0&&delta<=reminderWindowMs&&Number(e.end)>now;
 }).sort(function(a,b){return a.start-b.start;});
 for(var i=0;i<next.length;i++){
  var event=next[i],key=profileId+'|'+event.start+'|'+event.end+'|'+event.title;
  if(remindedEvents[key])continue;
  var el=$('#eventReminder');if(!el)return;
  if(Object.keys(remindedEvents).length>160)remindedEvents={};
  remindedEvents[key]=true;hideUpcomingReminder();
  var minutes=Math.max(1,Math.ceil((Number(event.start)-now)/60000));
  $('#reminderWhen').textContent='STARTS IN '+minutes+' MIN · '+calendarTime(event.start,false);
  $('#reminderTitle').textContent=String(event.title||'Untitled event').slice(0,120);
  el.setAttribute('aria-hidden','false');el.classList.add('visible');
  reminderTimer=setTimeout(hideUpcomingReminder,reminderVisibleMs);
  break;
 }
}
function updateCalendarView(){var n=Date.now(),today=calendarToday();
 var badge=$('#calendarBadge'),button=$('#calendarButton');badge.textContent=today.length>9?'9+':String(today.length);badge.classList.toggle('hidden',!today.length);button.classList.toggle('has-events',!!today.length);
 button.classList.toggle('calendar-attention',today.some(function(e){var state=calendarState(e);return state==='ongoing'||state==='soon';}));button.setAttribute('aria-label','Calendar: '+today.length+' event'+(today.length===1?'':'s')+' today');
 var peek=$('#calendarPeek');var next=calEvents.filter(function(e){return e.end>n&&(!e.allDay||e.start>n);})
  .sort(function(a,b){var an=a.start<=n,bn=b.start<=n;return an!==bn?(an?-1:1):a.start-b.start;}).slice(0,2);
 peek.innerHTML=calConnected&&next.length?'<div class="peek-heading">NOW / NEXT'+(!calVerified?' · SAVED':'')+'</div>'+next.map(function(e){return eventHTML(e,true);}).join(''):'';
 if(screen==='calendar')renderCalendarBody();else maybeShowUpcomingReminder();}
function receiveCalendar(json){try{if(profileId==='guest')return;var obj=typeof json==='string'?JSON.parse(json):json;if(!obj||obj.profile!==profileId)return;
 calendarProfile=obj.profile;calConnected=!!obj.connected;calVerified=!!obj.verified;calName=obj.calendarName||'';calLabel=obj.label||'';calAccount=obj.calendarId||'';calLastSuccess=Number(obj.lastSuccess)||0;calLastAttempt=Number(obj.lastAttempt)||0;
 calSources=Array.isArray(obj.sources)?obj.sources.filter(function(s){return s&&['google','sport'].indexOf(s.kind)>=0;}).slice(0,2):[];
 calEvents=Array.isArray(obj.events)?obj.events.filter(function(e){return e&&Number.isFinite(e.start)&&Number.isFinite(e.end);}).slice(0,150).map(function(e){
  return {title:String(e.title||'Untitled event').slice(0,120),start:e.start,end:e.end,allDay:!!e.allDay,
   uid:String(e.uid||'').slice(0,180),kind:['play','watch'].indexOf(e.kind)>=0?e.kind:'other',
   location:String(e.location||'').slice(0,180),description:String(e.description||'').slice(0,1400),
   channel:String(e.channel||'').slice(0,80),url:String(e.url||'').slice(0,512)};
 }):[];
 calEvents=dedupeCalendarEvents(calEvents);
 calStatus=obj.status||'';calendarChecked=Date.now();updateCalendarView();if(screen==='calendarSettings'||screen==='calendarSource')renderPanel(screen);/* Cached calendar status must never close a live phone pairing. */}catch(e){toast('Could not read calendar data');}}
function calendarSaveReady(profile,okay,message){if(profile!==profileId)return;
 if(okay){renderPanel('calendarSettings');toast('Private calendar saved');}else toast(message||'Could not save calendar');}
function qrSvg(url){if(!window.VelaQRCode)return '<span class="pair-url">'+esc(url)+'</span>';
 try {var q=new window.VelaQRCode(0,0);q.addData(url);q.make();var n=q.getModuleCount(),out='<svg class="pair-svg" viewBox="0 0 '+(n+8)+' '+(n+8)+'" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>';
 for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(q.isDark(y,x))out+='<rect x="'+(x+4)+'" y="'+(y+4)+'" width="1" height="1" fill="#101b1c"/>';return out+'</svg>';}
 catch(e){return '<span class="pair-url">'+esc(url)+'</span>';}}
function stopPairClock(){if(pairTimer){clearInterval(pairTimer);pairTimer=null;}}
function pairingTick(){
 if(screen!=='pairing'){stopPairClock();return;}
 var node=$('#pairCountdown');if(!node)return;
 if(!pairingUrl){node.textContent=pairingExpiresAt?'Code expired — choose Generate new QR.':'Waiting for TV pairing server…';return;}
 var seconds=Math.ceil((pairingExpiresAt-Date.now())/1000);
 if(seconds<=0){pairingUrl='';stopPairClock();renderPanel('pairing');return;}
 node.textContent='Ready to scan · expires in '+Math.floor(seconds/60)+':'+('0'+seconds%60).slice(-2);
}
function startPairing(){
 stopPairClock();pairingUrl='';pairingExpiresAt=0;renderPanel('pairing');
 if(bridge&&bridge.pairCalendar)bridge.pairCalendar(profileId);else toast('Phone pairing is only available on your TV');
}
function pairingReady(url,expires){
 if(screen!=='pairing')return;
 stopPairClock();pairingUrl=String(url||'');pairingExpiresAt=pairingUrl?(Number(expires)||Date.now()+600000):0;
 renderPanel('pairing');if(pairingUrl)pairTimer=setInterval(pairingTick,1000);
}
function pairingCompleted(profile){
 if(profile!==profileId)return;
 stopPairClock();pairingUrl='';pairingExpiresAt=0;
 if(screen==='pairing'){if(panelHistory.length&&panelHistory[panelHistory.length-1]==='calendarSettings')panelHistory.pop();renderPanel('calendarSettings');toast('Calendar link received · verifying feed…');}
}
function requestCalendar(force){if(profileId==='guest'){calConnected=false;calVerified=false;calEvents=[];updateCalendarView();return;}if(!bridge||!bridge.loadCalendar){if(preview&&calendarProfile!==profileId){calendarProfile=profileId;calConnected=false;calEvents=[];updateCalendarView();}return;}
 bridge.loadCalendar(profileId,!!force);}
function renderCalendarBody(){if(screen!=='calendar')return;
 var host=$('#panelContent'),oldScroll=host.scrollTop;
 var focus=focusedControl?{act:focusedControl.getAttribute('data-act'),id:focusedControl.getAttribute('data-id')}:null;
 var next=calendarEventList();
 if(lastCalendarMarkup===next)return;
 lastCalendarMarkup=next;host.innerHTML=next;host.scrollTop=oldScroll;listDirty=true;activeList();
 if(controls.length){
  var i=focus?controls.findIndex(function(el){return el.getAttribute('data-act')===focus.act&&el.getAttribute('data-id')===focus.id;}):-1;
  if(i<0)i=controls.findIndex(function(el){return el.getAttribute('data-act')!=='close';});
  select(i>=0?i:0);
 }
}
function wallpaperReady(uri){customPhoto=uri&&uri.indexOf('data:image/jpeg;base64,')===0?uri:'';setScenery();}
function refreshWallpaper(){if(bridge&&bridge.requestWallpaper)bridge.requestWallpaper();}
function receiveUpdateStatus(json){try{updateStatus=typeof json==='string'?JSON.parse(json):json;if(screen==='updates'){var key=focusedControl?{act:focusedControl.getAttribute('data-act'),id:focusedControl.getAttribute('data-id')||undefined,dir:focusedControl.getAttribute('data-dir')||undefined}:null;renderPanel('updates',key,true);}}catch(e){}}
function pause(){hideUpcomingReminder();hideVolume();if(calTimer){clearInterval(calTimer);calTimer=null;}if(rotationTimer){clearTimeout(rotationTimer);rotationTimer=null;}if(clockTimer){clearTimeout(clockTimer);clockTimer=null;}}
function resume(){rescheduleClock();scheduleRotation();checkWakeProfilePrompt();if(calTimer)clearInterval(calTimer);calTimer=setInterval(function(){updateCalendarView();if(!preview&&profileId!=='guest'&&Date.now()-calendarChecked>15*60000)requestCalendar(false);},60000);updateCalendarView();if(profileId!=='guest'&&Date.now()-calendarChecked>15*60000)requestCalendar(false);if(!preview&&Date.now()-lastCatalog>15*60000)refreshApps();if(window.VelaWeatherClient)window.VelaWeatherClient.resume();}
function init(){loadVolumePrefs();initProfiles();rescheduleClock();calTimer=setInterval(function(){updateCalendarView();if(!preview&&profileId!=='guest'&&Date.now()-calendarChecked>15*60000)requestCalendar(false);},60000);if(!preview&&bridge&&bridge.getCachedApps){try{var cached=bridge.getCachedApps();if(cached){receiveApps(cached);lastCatalog=Number(bridge.getCachedCatalogAt?bridge.getCachedCatalogAt():0)||0;}}catch(e){}}
 if(preview||!catalogSignature||Date.now()-lastCatalog>15*60000)refreshApps();else home();
 document.addEventListener('visibilitychange',function(){if(document.hidden)pause();else resume();});window.addEventListener('focus',resume);
 window.addEventListener('resize',function(){listDirty=true;});$('#panelContent').addEventListener('scroll',function(){listDirty=true;});refreshWallpaper();checkWakeProfilePrompt();document.body.classList.remove('booting');listDirty=true;activeList();if(!screen)select(Math.max(0,controls.findIndex(function(el){return el.classList.contains('app-card');})));scheduleRotation();if(window.VelaWeatherClient)window.VelaWeatherClient.start();}
document.addEventListener('click',function(e){var b=e.target.closest('button[data-act]');if(!b)return;var i;listDirty=true;activeList();i=controls.indexOf(b);if(i>=0)select(i);action(b.getAttribute('data-act'),b.getAttribute('data-id')||'',b.getAttribute('data-dir')||'');});
var previewEnterAt=0,previewLong=false;
document.addEventListener('keydown',function(e){if(!preview)return;
 if(e.key==='Enter'){e.preventDefault();if(!e.repeat){previewEnterAt=Date.now();previewLong=false;}else if(!previewLong&&Date.now()-previewEnterAt>=500){previewLong=true;remote('longselect');}return;}
 var k={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Escape:'back',Backspace:'back'}[e.key];if(k){e.preventDefault();remote(k);}});
document.addEventListener('keyup',function(e){if(preview&&e.key==='Enter'){e.preventDefault();if(!previewLong)remote('select');previewEnterAt=0;previewLong=false;}});
window.QH={pause:pause,checkWakeProfilePrompt:checkWakeProfilePrompt,profileNameReady:profileNameReady,profileDeleteConfirmed:profileDeleteConfirmed,remote:remote,remotePairedCountChanged:function(){if(screen==='remoteSettings'){var focus=focusedControl?{act:focusedControl.getAttribute('data-act'),id:focusedControl.getAttribute('data-id')||undefined}:null;renderPanel('remoteSettings',focus,true);}},remoteStatusReady:function(message){toast(message);if(screen==='remoteSettings')renderPanel('remoteSettings');},refreshApps:refreshApps,receiveApps:receiveApps,catalogRefreshed:catalogRefreshed,iconReady:iconReady,refreshWallpaper:refreshWallpaper,wallpaperReady:wallpaperReady,resume:resume,tick:clock,updateStatusReady:receiveUpdateStatus,receiveCalendar:receiveCalendar,calendarSaveReady:calendarSaveReady,pairingReady:pairingReady,pairingCompleted:pairingCompleted,volumeChanged:volumeChanged,watchChannelReady:watchChannelReady,weatherReady:function(data){if(window.VelaWeatherClient)window.VelaWeatherClient.receive(data);}};
init();
})();
