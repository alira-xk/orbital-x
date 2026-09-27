import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

for (const path of ['scripts/verify.ps1', 'scripts/e2e-propulsion-leak.mjs']) {
  assert.equal(existsSync(path), true, `${path} must exist`);
}
const readme = readFileSync('README.md', 'utf8');
assert.doesNotMatch(readme, /Phase 10: Polish[\s\S]{0,200}- \[ \]/);
assert.match(readme, /\.\\scripts\\verify\.ps1/);

for (const path of [
  'backend/src/auth/auth.test.ts',
  'backend/src/incident/alertService.test.ts',
  'backend/src/incident/databaseMigration.postgres.test.ts',
  'scripts/e2e-propulsion-leak.mjs',
]) {
  assert.match(
    readFileSync(path, 'utf8'),
    /unix_socket_directories/,
    `${path} must place disposable PostgreSQL sockets in its writable temp directory`,
  );
}
