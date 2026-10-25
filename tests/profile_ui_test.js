#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/main/assets/style.css'), 'utf8');
const start = source.indexOf('function uiTitle(text)');
const end = source.indexOf('function appRow(', start);
assert.ok(start >= 0 && end > start, 'Settings case helper is present');
const context = {esc: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

assert.equal(context.uiTitle('Daily life'), 'Daily Life');
assert.equal(context.uiTitle('Apps & activity'), 'Apps & Activity');
assert.equal(context.uiTitle('Device & support'), 'Device & Support');
assert.equal(context.uiTitle('Software updates'), 'Software Updates');
assert.equal(context.uiTitle('Sony TV & iCal sources'), 'Sony TV & iCal Sources');
assert.match(context.row('test', 'Home favorites', 'Edit', 'Original subtitle'), />Home Favorites</);
assert.match(context.row('test', 'Home favorites', 'Edit', 'Original subtitle'), /Original subtitle/);
assert.ok(source.includes("type==='appMenu'||type==='calendarSettings'"), 'User app/profile names retain their original capitalization');

assert.ok(css.includes('.overlay.startup-panel{z-index:80;background:radial-gradient('), 'Profile gate has opaque dark background');
assert.ok(css.includes('background:linear-gradient(143deg,rgba(255,255,255,.095)'), 'Profile shelf has layered translucent glass');
assert.ok(css.includes('.startup-avatar-card.selected,.startup-avatar-card:focus'), 'Focus remains visible with remote navigation');
assert.ok(!css.includes('backdrop-filter:'), 'Do not rely on TV GPU backdrop blur');
assert.ok(!css.includes('background:linear-gradient(155deg,#608a88,#315252)'), 'Old colored profile blocks removed');
console.log('PASS cinematic glass profile chooser, remote focus and consistent Settings Title Case');
