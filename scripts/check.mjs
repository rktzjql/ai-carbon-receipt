import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...manifest.content_scripts.flatMap(x => x.js)];
for (const file of files) assert.ok(existsSync(file), `Missing ${file}`);
for (const file of readdirSync('.').filter(x => x.endsWith('.js'))) execFileSync(process.execPath, ['--check', file]);
for (const file of ['panel.html','options.html']) {
  const html = readFileSync(file,'utf8');
  assert.ok(!/\son\w+\s*=/.test(html), 'Inline handlers are forbidden');
  for (const [, path] of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)) assert.ok(existsSync(path), `Missing ${path}`);
}
console.log('Manifest paths, JavaScript syntax, local HTML assets and inline-handler checks passed.');
