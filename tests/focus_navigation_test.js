#!/usr/bin/env node
'use strict';
// Run the real nested Back implementation with a small focus/scroll harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const part = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${start} in app source`);
  return source.slice(a, b);
};
const panel = { scrollTop: 115 };
let selected = '', closed = false;
const ctx = {
  screen:'settings', panelHistory:[], listDirty:false, startupChooserOpen:false,
  focusedControl:{ getAttribute(name) { return name === 'data-act' ? 'homeSettings' : null; } },
  $:() => panel,
  renderPanel(name, key) { ctx.screen = name; selected = key?.act || ''; panel.scrollTop = 0; },
  close(){closed = true;},
  stopPairClock(){}, bridge:null, pairingUrl:'',pairingExpiresAt:0,
};
vm.createContext(ctx);
vm.runInContext(part('function navigatePanel(type)', 'function openProfileSelector()') + '\n' +
  part('function goBack(){', 'function remote(key)'), ctx);
ctx.navigatePanel('homeSettings');
assert.equal(ctx.screen, 'homeSettings');
assert.equal(ctx.panelHistory.length, 1);
ctx.goBack();
assert.equal(ctx.screen, 'settings');
assert.equal(selected, 'homeSettings', 'Back restores the opening row, not the first control');
assert.equal(panel.scrollTop, 115, 'Back restores the prior drawer scroll position');
assert.equal(ctx.listDirty, true, 'geometry is invalidated after restoring scroll');
assert.equal(closed, false);
ctx.goBack();
assert.equal(closed, true, 'second Back exits Settings');
console.log('PASS nested Settings Back restores focus and scroll, then exits cleanly');
