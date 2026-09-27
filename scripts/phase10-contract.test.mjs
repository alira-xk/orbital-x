import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

for (const path of ['scripts/verify.ps1', 'scripts/e2e-propulsion-leak.mjs']) {
  assert.equal(existsSync(path), true, `${path} must exist`);
}
const readme = readFileSync('README.md', 'utf8');
assert.doesNotMatch(readme, /Phase 10: Polish[\s\S]{0,200}- \[ \]/);
assert.match(readme, /\.\\scripts\\verify\.ps1/);
