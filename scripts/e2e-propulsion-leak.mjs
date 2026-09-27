import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import dotenv from 'dotenv';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
dotenv.config({ path: `${root}/.env` });
const runId = `phase10-${Date.now()}`;
const spacecraftId = `ORBITAL-X1-${runId}`;
const username = runId;
const password = `E2E-${crypto.randomUUID()}`;
const port = 3100;
const base = `http://127.0.0.1:${port}`;
const telemetryStream = `telemetry:${runId}`;
const commandStream = `commands:${runId}`;
const resultStream = `command-results:${runId}`;
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
let db;
let backend;
let userId;
let pgData;
let pgCtl;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}\n${output}`)));
  });
}
async function postgresBinary(name) {
  if (process.env.PG_BIN) return join(process.env.PG_BIN, process.platform === 'win32' ? `${name}.exe` : name);
  if (process.platform !== 'win32') return name;
  const base = 'C:/Program Files/PostgreSQL';
  const versions = existsSync(base) ? await readdir(base) : [];
  const path = versions.sort((a, b) => Number(b) - Number(a)).map(version => join(base, version, 'bin', `${name}.exe`)).find(existsSync);
  if (!path) throw new Error('PostgreSQL client tools were not found; set PG_BIN to their bin directory');
  return path;
}
async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  assert.equal(response.ok, true, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { body, response };
}
function simulator(ticks) {
  return run('python', ['main.py', '--scenario', 'PROPULSION_LEAK', '--ticks', String(ticks), '--speed', '10', '--real-dt', '0.1', '--seed', '7', '--spacecraft-id', spacecraftId, '--output', `${runId}.jsonl`], {
    cwd: `${root}/simulator`, env: { ...process.env, TELEMETRY_REDIS_STREAM: telemetryStream, SPACECRAFT_ID: spacecraftId, COMMAND_REDIS_STREAM: commandStream, COMMAND_RESULT_REDIS_STREAM: resultStream, COMMAND_REDIS_GROUP: `simulator-${runId}` },
  });
}
try {
  await redis.ping();
  const pgPort = 55432 + Math.floor(Math.random() * 500);
  pgData = await mkdtemp(join(tmpdir(), 'orbital-x-phase10-'));
  const initdb = await postgresBinary('initdb'); pgCtl = await postgresBinary('pg_ctl');
  const createdb = await postgresBinary('createdb'); const psql = await postgresBinary('psql');
  await run(initdb, ['-D', pgData, '--auth=trust', '--username=postgres', '--encoding=UTF8']);
  const socketOption = process.platform === 'win32' ? '' : ` -c unix_socket_directories=${pgData}`;
  await run(pgCtl, ['-D', pgData, '-o', `-p ${pgPort} -h 127.0.0.1${socketOption}`, '-w', 'start']);
  await run(createdb, ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', 'orbital_x']);
  await run(psql, ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-d', 'orbital_x', '-f', `${root}/database/init.sql`]);
  const databaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/orbital_x`;
  db = new pg.Pool({ connectionString: databaseUrl }); await db.query('SELECT 1');
  const hash = await bcrypt.hash(password, 10);
  const created = await db.query("INSERT INTO users(email,username,password_hash,role) VALUES($1,$2,$3,'mission_commander') RETURNING id", [`${username}@example.test`, username, hash]);
  userId = created.rows[0].id;
  backend = spawn('node', ['backend/dist/index.js'], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(pgPort), DATABASE_NAME: 'orbital_x', DATABASE_USER: 'postgres', DATABASE_PASSWORD: '', PORT: String(port), NODE_ENV: 'test', JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(), TELEMETRY_STREAM_NAME: telemetryStream, TELEMETRY_CONSUMER_GROUP: `backend-${runId}`, COMMAND_STREAM_NAME: commandStream, COMMAND_RESULT_STREAM_NAME: resultStream, COMMAND_RESULT_GROUP: `results-${runId}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let backendLog = ''; backend.stdout.on('data', c => { backendLog += c; }); backend.stderr.on('data', c => { backendLog += c; });
  await waitFor(async () => fetch(`${base}/health/ready`).then(r => r.ok).catch(() => false), 'backend readiness');
  await simulator(45);
  const incident = await waitFor(async () => (await db.query("SELECT id,status FROM incidents WHERE spacecraft_id=$1 ORDER BY created_at DESC LIMIT 1", [spacecraftId])).rows[0], 'correlated incident');
  const login = await api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookies = login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const requested = await api(`/api/incidents/${incident.id}/commands`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies }, body: JSON.stringify({ commandType: 'CLOSE_ISOLATION_VALVE', parameters: {}, expectedIncidentStatus: incident.status }) });
  const commandId = requested.body.data.id;
  await api(`/api/commands/${commandId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies }, body: JSON.stringify({ expectedStatus: 'pending_approval' }) });
  await simulator(30);
  const command = await waitFor(async () => (await db.query('SELECT status,result FROM commands WHERE id=$1', [commandId])).rows[0]?.status === 'completed' ? (await db.query('SELECT status,result FROM commands WHERE id=$1', [commandId])).rows[0] : null, 'completed recovery command');
  const samples = [];
  for (let index = 0; index < 25; index++) { const start = performance.now(); await api('/health'); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  const counts = await db.query('SELECT (SELECT count(*)::int FROM telemetry WHERE spacecraft_id=$1) telemetry, (SELECT count(*)::int FROM alerts WHERE spacecraft_id=$1) alerts', [spacecraftId]);
  const evidence = { measuredAt: new Date().toISOString(), flow: 'simulator -> Redis -> backend -> PostgreSQL -> incident -> authenticated approval -> simulator -> result', spacecraftId, telemetryFrames: counts.rows[0].telemetry, alerts: counts.rows[0].alerts, incidentId: incident.id, commandId, commandStatus: command.status, changedFields: command.result?.changedFields ?? [], healthLatencyMs: { samples: samples.length, median: Number(samples[Math.floor(samples.length / 2)].toFixed(2)), p95: Number(samples[Math.floor(samples.length * .95)].toFixed(2)), max: Number(samples.at(-1).toFixed(2)) } };
  await mkdir(`${root}/docs/evidence`, { recursive: true }); await writeFile(`${root}/docs/evidence/phase10-verification.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  backend?.kill('SIGTERM');
  if (userId) {
    await db.query('DELETE FROM incidents WHERE spacecraft_id=$1', [spacecraftId]).catch(() => {});
    await db.query('DELETE FROM alerts WHERE spacecraft_id=$1', [spacecraftId]).catch(() => {});
    await db.query('DELETE FROM telemetry WHERE spacecraft_id=$1', [spacecraftId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
  }
  await redis.del(telemetryStream, commandStream, resultStream).catch(() => {});
  await redis.quit().catch(() => {}); await db?.end().catch(() => {});
  if (pgCtl && pgData) await run(pgCtl, ['-D', pgData, '-m', 'fast', '-w', 'stop']).catch(() => {});
  if (pgData?.startsWith(tmpdir())) await rm(pgData, { recursive: true, force: true }).catch(() => {});
}
