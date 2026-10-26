#!/usr/bin/env node
'use strict';
// Optional local visual review (Playwright/Sharp are NOT APK/WGT dependencies).
// Capture synthetic screens only; never load a real private calendar or relay.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dest = path.resolve(process.argv[3] || path.join(root, 'design/review/quiet-glass-v1'));
const browserExecutable = process.env.VELA_CHROMIUM_PATH || undefined;
function fixedPreviewClock() {
  // Sunday Oct 25 at 8:42 PM in America/Los_Angeles; already Oct 26 UTC.
  // Both browser contexts must use the same timezone to avoid fixture drift.
  const RealDate=Date, fixed=Date.parse('2026-10-26T03:42:00Z');
  window.Date=class extends RealDate {
    constructor(...args) { super(...(args.length?args:[fixed])); }
    static now() { return fixed; }
  };
}

async function main() {
  fs.mkdirSync(dest, { recursive: true });
  const browser = await chromium.launch({ headless:true,
    ...(browserExecutable ? { executablePath:browserExecutable } : {}),
    args:['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport:{ width:1920, height:1080 },
      timezoneId:'America/Los_Angeles',deviceScaleFactor:1, reducedMotion:'reduce' });
    await page.addInitScript(fixedPreviewClock);
    await page.goto(pathToFileURL(path.join(root, 'preview/index.html')).href);
    await page.waitForSelector('#favorites .app-card');
    assert.equal(await page.locator('#clock').textContent(),'8:42','Pacific fixture clock');
    assert.equal(await page.locator('#daydate').textContent(),'SUNDAY, OCTOBER 25','Pacific fixture day');
    const homeStartupMs = await page.evaluate(() => Math.round(performance.now()));
    await page.evaluate(() => {
      // These are explicitly synthetic design fixtures, not live weather or a
      // private feed. Source never sends them to a server.
      const now = Date.now();
      window.QH.receiveCalendar({ profile:'duong',connected:true,verified:true,
        sources:[{kind:'google'},{kind:'sport'}],lastSuccess:now,
        events:[{uid:'demo-playing',title:'Evening Pickup',kind:'play',location:'Community Field',
          start:now-20*60000,end:now+60*60000,allDay:false},
          {uid:'demo-watching',title:'Weekend Football',kind:'watch',
          start:now+75*60000,end:now+195*60000,allDay:false}] });
      const weather = document.querySelector('#weatherCard');
      weather.classList.remove('hidden');weather.dataset.kind='cloud';
      document.querySelector('#weatherTemp').textContent='68°';
      document.querySelector('#weatherCondition').textContent='Partly cloudy';
      document.querySelector('#weatherLocation').textContent='Sample location';
      document.querySelector('#weatherPrecip').textContent='Preview only';
    });
    const safeHome=await page.evaluate(() => {
      const r=document.querySelector('#favorites').getBoundingClientRect();
      return {left:r.left,right:r.right,width:innerWidth};
    });
    assert.ok(safeHome.left>=safeHome.width*.04 && safeHome.right<=safeHome.width*.96,
      'TV dock stays clear of overscan-sensitive edges');
    async function shot(name, width) {
      await page.setViewportSize({ width, height:1080 });
      const png = await page.screenshot({ animations:'disabled' });
      await sharp(png).webp({ quality:78, effort:5 }).toFile(path.join(dest,name+'.webp'));
    }
    await shot('home-1080p',1920);
    await page.locator('#profileButton').click();
    const medallions=await page.locator('.startup-avatar').evaluateAll(nodes =>
      nodes.slice(0,3).map(node => {const r=node.getBoundingClientRect();
        return {left:r.left,right:r.right,width:r.width,height:r.height};}));
    assert.equal(medallions.length,3);
    assert.ok(medallions.every(m=>Math.abs(m.width-m.height)<1),'medallions remain circular');
    assert.ok(Math.abs((medallions[1].left-medallions[0].right)-
      (medallions[2].left-medallions[1].right))<2,'profile gaps are even');
    await shot('profiles-1080p',1920);
    await page.keyboard.press('Escape');
    await page.locator('#calendarButton').click();
    await shot('calendar-1080p',1920);
    await page.keyboard.press('Escape');
    await page.locator('#settingsButton').click();
    await shot('settings-1080p',1920);
    await page.keyboard.press('Escape');
    // 4K television: 1920 CSS pixels at DPR 2, not an implausibly wide
    // 3840-CSS-pixel viewport. The resulting source is a 3840×2160 bitmap.
    await page.setViewportSize({ width:1920, height:1080 });
    const hidpi = await browser.newPage({ viewport:{width:1920,height:1080},
      timezoneId:'America/Los_Angeles',deviceScaleFactor:2,reducedMotion:'reduce' });
    await hidpi.addInitScript(fixedPreviewClock);
    await hidpi.goto(pathToFileURL(path.join(root,'preview/index.html')).href);
    await hidpi.waitForSelector('#favorites .app-card');
    assert.equal(await hidpi.locator('#clock').textContent(),'8:42','4K Pacific fixture clock');
    assert.equal(await hidpi.locator('#daydate').textContent(),'SUNDAY, OCTOBER 25','4K Pacific fixture day');
    const fourK=await hidpi.screenshot({animations:'disabled'});
    const fourKMeta=await sharp(fourK).metadata();
    assert.equal(fourKMeta.width,3840);
    assert.equal(fourKMeta.height,2160);
    await sharp(fourK).webp({quality:76,effort:5}).toFile(path.join(dest,'home-4k-scaling.webp'));
    await hidpi.close();
    await page.close();

    const phone=await browser.newPage({viewport:{width:390,height:844},
      deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    await phone.goto(pathToFileURL(path.join(root,'remote/index.html')).href);
    await phone.waitForTimeout(550); // finish async private-key bootstrap before synthetic presentation
    await phone.evaluate(() => {
      document.querySelector('#pair').classList.add('hidden');
      document.querySelector('#controller').classList.remove('hidden');
      document.querySelector('#tvPill span').textContent='Sony BRAVIA 4K VH2';
      document.querySelector('#network span').textContent='Connected · Preview';
    });
    // Resize the exact same paired-controller state rather than testing only
    // one newer iPhone. A short display is the limiting case for this layout.
    for (const [width,height] of [[320,568],[375,667],[390,844],[430,932]]) {
      await phone.setViewportSize({width,height});
      const size=await phone.evaluate(() => ({body:document.body.scrollHeight,
        view:innerHeight,controller:document.querySelector('#controller').getBoundingClientRect().bottom,
        pill:document.querySelector('#tvPill').getBoundingClientRect().width}));
      assert.ok(size.body<=size.view+1,`${width}×${height} remote must not scroll vertically`);
      assert.ok(size.controller<=size.view,`${width}×${height} controller must fit the viewport`);
      assert.ok(size.pill>=100,`${width}×${height} TV switcher must remain legible`);
    }
    await phone.setViewportSize({width:390,height:844});
    const rp=await phone.screenshot({animations:'disabled'});
    await sharp(rp).webp({quality:82,effort:5}).toFile(path.join(dest,'phone-390.webp'));
    await phone.close();
    // This is Chromium source-preview readiness, NOT Android cold-start or
    // actual device memory/CPU. Keep the number diagnostic, never a release gate.
    console.log('Captured synthetic visual review in '+dest+
      ` (Chromium Home DOM ready ${homeStartupMs}ms; phone sizes 320–430px fit)`);
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
