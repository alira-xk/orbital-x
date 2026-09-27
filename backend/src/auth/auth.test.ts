import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../app.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AuthService } from './service.js';
import { PostgresAuthRepository } from './repository.js';
import type { AuthAccount, AuthRepository, AuthSession } from './types.js';

const profile = { id: randomUUID(), username: 'operator', role: 'viewer' };
const password = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
const settings = { secret, expiresIn: '15m', refreshExpiresIn: '7d' };

class MemoryAuthRepository implements AuthRepository {
  account: AuthAccount = {
    ...profile, email: 'operator@example.test', passwordHash: '', isActive: true,
  };
  sessions = new Map<string, AuthSession & { revoked: boolean }>();
  failure = false;

  async findByLogin(login: string): Promise<AuthAccount | null> {
    if (this.failure) throw new Error('storage failed');
    return login === this.account.username || login === this.account.email ? this.account : null;
  }
  async findById(id: string): Promise<AuthAccount | null> {
    if (this.failure) throw new Error('storage failed');
    return id === this.account.id ? this.account : null;
  }
  async createSession(session: AuthSession): Promise<void> {
    if (this.failure) throw new Error('storage failed');
    this.sessions.set(session.tokenHash, { ...session, revoked: false });
  }
  async rotateSession(hash: string, session: AuthSession): Promise<boolean> {
    if (this.failure) throw new Error('storage failed');
    const previous = this.sessions.get(hash);
    if (!previous || previous.revoked || previous.userId !== session.userId || previous.expiresAt <= new Date()) {
      return false;
    }
    previous.revoked = true;
    this.sessions.set(session.tokenHash, { ...session, revoked: false });
    return true;
  }
}

function cookies(response: request.Response): string[] {
  return response.get('Set-Cookie') as unknown as string[];
}

function token(response: request.Response, name: string): string {
  return cookies(response).find(value => value.startsWith(`${name}=`))!.split(';')[0].slice(name.length + 1);
}

describe('authentication HTTP contract', () => {
  let repository: MemoryAuthRepository;
  let service: AuthService;
  beforeEach(async () => {
    repository = new MemoryAuthRepository();
    repository.account.passwordHash = await bcrypt.hash(password, 4);
    service = new AuthService(repository, settings);
  });
  beforeAll(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('registers auth routes and reports unavailable injected storage', async () => {
    const response = await request(createApp()).post('/api/auth/login')
      .send({ username: profile.username, password });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it.each([
    { username: 'operator' },
    { username: 'operator@example.test' },
    { email: 'operator@example.test' },
  ])('logs in using %j and exposes only a profile', async (identity) => {
    const response = await request(createApp({ authService: service })).post('/api/auth/login')
      .send({ ...identity, password });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: profile });
    expect(cookies(response)).toHaveLength(2);
    for (const cookie of cookies(response)) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    }
    const access = jwt.verify(token(response, 'access_token'), secret) as jwt.JwtPayload;
    const refresh = jwt.verify(token(response, 'refresh_token'), secret) as jwt.JwtPayload;
    expect(access).toMatchObject({ sub: profile.id, username: 'operator', role: 'viewer' });
    expect(access.exp! - access.iat!).toBe(900);
    expect(refresh).toMatchObject({ sub: profile.id, type: 'refresh' });
    expect(refresh.exp! - refresh.iat!).toBe(604800);
    expect(refresh.jti).toEqual(expect.any(String));
    const hash = createHash('sha256').update(token(response, 'refresh_token')).digest('hex');
    expect(repository.sessions.get(hash)).toMatchObject({ userId: profile.id, revoked: false });
    expect(JSON.stringify([...repository.sessions.values()])).not.toContain(token(response, 'refresh_token'));
  });

  it.each([
    ['operator', 'wrong'], ['missing', password],
  ])('rejects bad credentials for %s', async (username, suppliedPassword) => {
    const response = await request(createApp({ authService: service })).post('/api/auth/login')
      .send({ username, password: suppliedPassword });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.get('Set-Cookie')).toBeUndefined();
    expect(repository.sessions.size).toBe(0);
  });

  it('rejects inactive users at login and on subsequent access and refresh', async () => {
    const tokens = await service.login('operator', password);
    repository.account.isActive = false;
    await expect(service.login('operator', password)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.me(tokens.accessToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(repository.sessions.size).toBe(1);
  });

  it.each([{}, { username: '' }, { username: 'operator', password: 123 },
    { username: 'operator', email: 'operator@example.test', password },
    { username: 'operator', password: '' }, { username: {}, password },
  ])('rejects malformed credentials (%#)', async (body) => {
    const response = await request(createApp({ authService: service })).post('/api/auth/login').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the current database profile on /me', async () => {
    const tokens = await service.login('operator', password);
    repository.account.role = 'engineer';
    const response = await request(createApp({ authService: service })).get('/api/auth/me')
      .set('Cookie', `access_token=${tokens.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { ...profile, role: 'engineer' } });
  });

  it('sets secure, bounded cookies in production and prevents profile caching', async () => {
    const environment = jest.replaceProperty(config, 'nodeEnv', 'production');
    try {
      const response = await request(createApp({ authService: service })).post('/api/auth/login')
        .send({ username: 'operator', password });
      expect(response.status).toBe(200);
      for (const cookie of cookies(response)) {
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Expires=');
      }
      expect(cookies(response).find(cookie => cookie.startsWith('refresh_token='))).toContain('Path=/api/auth;');
      expect(cookies(response).find(cookie => cookie.startsWith('access_token='))).toContain('Path=/;');
      expect(response.get('Cache-Control')).toBe('no-store');
      const me = await request(createApp({ authService: service })).get('/api/auth/me')
        .set('Cookie', `access_token=${token(response, 'access_token')}`);
      expect(me.get('Cache-Control')).toBe('no-store');
    } finally {
      environment.restore();
    }
  });

  it('returns a structured validation error for malformed JSON without logging submitted content', async () => {
    const response = await request(createApp({ authService: service })).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{"password":');
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid login request' });
  });

  it.each([undefined, 'invalid', '%broken',
    jwt.sign({ ...profile, sub: profile.id, type: 'access' }, secret, { expiresIn: -1 }),
    jwt.sign({ sub: profile.id, type: 'refresh' }, secret, { expiresIn: '1h' }),
    jwt.sign({ sub: profile.id, type: 'access' }, secret, { expiresIn: '1h' }),
    jwt.sign({ sub: profile.id, username: 'operator', role: 'viewer' }, randomBytes(32).toString('hex')),
  ])('rejects missing, malformed, expired, wrong-type or untrusted access cookies (%#)', async (accessToken) => {
    const pending = request(createApp({ authService: service })).get('/api/auth/me');
    if (accessToken) pending.set('Cookie', `access_token=${accessToken}`);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates both cookies, rejects replay and accepts the new refresh session', async () => {
    const app = createApp({ authService: service });
    const login = await request(app).post('/api/auth/login').send({ username: 'operator', password });
    const oldRefresh = token(login, 'refresh_token');
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', `refresh_token=${oldRefresh}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toEqual({ success: true, data: profile });
    expect(token(refreshed, 'refresh_token')).not.toBe(oldRefresh);
    expect(token(refreshed, 'access_token')).not.toBe(token(login, 'access_token'));
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', `refresh_token=${oldRefresh}`);
    expect(replay.status).toBe(401);
    const next = await request(app).post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${token(refreshed, 'refresh_token')}`);
    expect(next.status).toBe(200);
  });

  it('allows only one concurrent refresh of a session', async () => {
    const tokens = await service.login('operator', password);
    const results = await Promise.allSettled([service.refresh(tokens.refreshToken), service.refresh(tokens.refreshToken)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it.each([undefined, 'invalid',
    jwt.sign({ sub: profile.id, type: 'refresh', jti: randomUUID() }, secret, { expiresIn: -1 }),
    jwt.sign({ sub: profile.id, type: 'refresh', jti: randomUUID() }, secret, { expiresIn: '1h' }),
    jwt.sign({ sub: profile.id, type: 'access', jti: randomUUID() }, secret, { expiresIn: '1h' }),
  ])('rejects missing, invalid, expired, unknown or wrong-type refresh tokens (%#)', async (refreshToken) => {
    const pending = request(createApp({ authService: service })).post('/api/auth/refresh');
    if (refreshToken) pending.set('Cookie', `refresh_token=${refreshToken}`);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(['expired', 'revoked'])('rejects a valid refresh JWT whose stored session is %s', async (state) => {
    const tokens = await service.login('operator', password);
    const session = [...repository.sessions.values()][0];
    if (state === 'expired') session.expiresAt = new Date(0);
    else session.revoked = true;
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('maps storage failures to structured 503 responses', async () => {
    const tokens = await service.login('operator', password);
    repository.failure = true;
    const app = createApp({ authService: service });
    const responses = await Promise.all([
      request(app).post('/api/auth/login').send({ username: 'operator', password }),
      request(app).get('/api/auth/me').set('Cookie', `access_token=${tokens.accessToken}`),
      request(app).post('/api/auth/refresh').set('Cookie', `refresh_token=${tokens.refreshToken}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('does not issue cookies if storing the refresh session fails', async () => {
    jest.spyOn(repository, 'createSession').mockRejectedValue(new Error('storage failed'));
    const response = await request(createApp({ authService: service })).post('/api/auth/login')
      .send({ username: 'operator', password });
    expect(response.status).toBe(503);
    expect(response.get('Set-Cookie')).toBeUndefined();
  });

  it('limits login attempts using configured auth limits without blocking /me', async () => {
    const tokens = await service.login('operator', password);
    const app = createApp({ authService: service });
    for (let attempt = 0; attempt < config.rateLimit.authMaxRequests; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ username: 'operator', password: 'wrong' });
      expect(response.status).toBe(401);
    }
    const limited = await request(app).post('/api/auth/login').send({ username: 'operator', password });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT');
    expect(Number(limited.get('Retry-After'))).toBeGreaterThan(0);
    const me = await request(app).get('/api/auth/me').set('Cookie', `access_token=${tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('does not let direct clients bypass the login limit by rotating forwarded headers', async () => {
    const app = createApp({ authService: service });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < config.rateLimit.authMaxRequests + 2; attempt += 1) {
      const response = await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
        .send({ username: 'operator', password: 'wrong' });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, config.rateLimit.authMaxRequests)).toEqual(Array(config.rateLimit.authMaxRequests).fill(401));
    expect(statuses.slice(config.rateLimit.authMaxRequests)).toEqual([429, 429]);
  });

  it('ignores forwarded clients from a peer outside the configured proxy addresses', async () => {
    const proxies = jest.replaceProperty(config, 'trustedProxies', ['192.0.2.10']);
    try {
      const app = createApp({ authService: service });
      for (let attempt = 0; attempt <= config.rateLimit.authMaxRequests; attempt += 1) {
        const response = await request(app).post('/api/auth/login')
          .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
          .send({ username: 'operator', password: 'wrong' });
        expect(response.status).toBe(attempt < config.rateLimit.authMaxRequests ? 401 : 429);
      }
    } finally {
      proxies.restore();
    }
  });

  it('honors explicit trusted proxy addresses while ignoring client-prepended spoofed hops', async () => {
    const proxies = jest.replaceProperty(config, 'trustedProxies', ['127.0.0.1/32', '::1/128']);
    try {
      const app = createApp({ authService: service });
      for (let attempt = 0; attempt <= config.rateLimit.authMaxRequests; attempt += 1) {
        const response = await request(app).post('/api/auth/login')
          .set('X-Forwarded-For', `203.0.113.${attempt + 1}, 198.51.100.20`)
          .send({ username: 'operator', password: 'wrong' });
        expect(response.status).toBe(attempt < config.rateLimit.authMaxRequests ? 401 : 429);
      }
      const separateClient = await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.21')
        .send({ username: 'operator', password: 'wrong' });
      expect(separateClient.status).toBe(401);
    } finally {
      proxies.restore();
    }
  });

  it.each(['', '   ', 'change-this-secret-in-production', 'your-super-secret-jwt-key-change-this-in-production'])(
    'refuses unsafe production signing configuration (%#)', unsafeSecret => {
      const environment = jest.replaceProperty(config, 'nodeEnv', 'production');
      const jwtSettings = jest.replaceProperty(config, 'jwt', { ...settings, secret: unsafeSecret });
      try {
        expect(() => new AuthService(repository)).toThrow('Production authentication requires a configured, non-default JWT secret');
      } finally {
        jwtSettings.restore();
        environment.restore();
      }
    },
  );

  it('enables production authentication with a configured signing secret', async () => {
    const environment = jest.replaceProperty(config, 'nodeEnv', 'production');
    const jwtSettings = jest.replaceProperty(config, 'jwt', settings);
    try {
      const productionService = new AuthService(repository);
      const tokens = await productionService.login('operator', password);
      expect(jwt.verify(tokens.accessToken, secret)).toMatchObject({ sub: profile.id, role: profile.role });
      await expect(productionService.me(tokens.accessToken)).resolves.toEqual(profile);
    } finally {
      jwtSettings.restore();
      environment.restore();
    }
  });
});

describe('authentication repository against PostgreSQL', () => {
  let directory: string;
  let bin: string;
  let started = false;
  let pool: Pool;
  let repository: PostgresAuthRepository;
  let account: AuthAccount;
  const suffix = process.platform === 'win32' ? '.exe' : '';

  async function control(args: string[]): Promise<void> {
    await new Promise<void>((resolveExit, reject) => {
      const child = spawn(join(bin, `pg_ctl${suffix}`), args, { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`pg_ctl exited with code ${code}`)));
    });
  }

  beforeAll(async () => {
    const root = join(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL');
    const installed = existsSync(root) ? readdirSync(root).sort().reverse().map(version => join(root, version, 'bin')) : [];
    const candidates = process.env.PG_BIN ? [process.env.PG_BIN] : [...(process.env.PATH ?? '').split(delimiter), ...installed];
    const found = candidates.find(candidate => existsSync(join(candidate, `initdb${suffix}`)) && existsSync(join(candidate, `pg_ctl${suffix}`)));
    if (!found) throw new Error('Auth PostgreSQL tests require initdb and pg_ctl on PATH, or PG_BIN.');
    bin = found;
    directory = mkdtempSync(join(tmpdir(), 'orbital-auth-pg-'));
    const server = createServer();
    await new Promise<void>((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePort);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP port');
    const port = address.port;
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await promisify(execFile)(join(bin, `initdb${suffix}`), [
      '-D', join(directory, 'data'), '-U', 'auth_test', '-A', 'trust', '--locale=C', '--encoding=UTF8', '--no-sync',
    ], { windowsHide: true, timeout: 90000 });
    await control(['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    started = true;
    pool = new Pool({ host: '127.0.0.1', port, user: 'auth_test', database: 'postgres' });
    await pool.query(readFileSync(resolve(__dirname, '../../../database/init.sql'), 'utf8'));
    repository = new PostgresAuthRepository(pool);
    account = { ...profile, email: 'operator@example.test', passwordHash: await bcrypt.hash(password, 4), isActive: true };
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (started) await control(['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    if (directory && (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('orbital-auth-pg-'))) {
      throw new Error('Refusing to remove a cluster outside the temporary directory');
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  }, 60000);

  beforeEach(async () => {
    await pool.query('DELETE FROM auth_sessions');
    await pool.query('DELETE FROM users');
    await pool.query('INSERT INTO users(id, username, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [account.id, account.username, account.email, account.role, account.passwordHash]);
  });

  function session(userId = profile.id): AuthSession {
    return { id: randomUUID(), userId, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000) };
  }

  it('finds accounts by username, email or ID and does not interpolate SQL input', async () => {
    expect(await repository.findByLogin('operator')).toEqual(account);
    expect(await repository.findByLogin('operator@example.test')).toEqual(account);
    expect(await repository.findById(account.id)).toEqual(account);
    expect(await repository.findById(randomUUID())).toBeNull();
    expect(await repository.findByLogin("' OR true --")).toBeNull();
    expect(await repository.findByLogin('missing')).toBeNull();
  });

  it('rejects an identifier shared between one username and another email', async () => {
    await pool.query('INSERT INTO users(username, email, password_hash) VALUES ($1, $2, $3)',
      ['operator@example.test', 'other@example.test', account.passwordHash]);
    expect(await repository.findByLogin('operator@example.test')).toBeNull();
  });

  it('persists session hashes with their exact user and expiry', async () => {
    const next = session();
    await repository.createSession(next);
    const { rows } = await pool.query('SELECT id, user_id, token_hash, expires_at, revoked_at FROM auth_sessions');
    expect(rows).toEqual([{ id: next.id, user_id: next.userId, token_hash: next.tokenHash, expires_at: next.expiresAt, revoked_at: null }]);
  });

  it('atomically rotates a session only once under concurrent use', async () => {
    const previous = session();
    await repository.createSession(previous);
    const results = await Promise.all([
      repository.rotateSession(previous.tokenHash, session()), repository.rotateSession(previous.tokenHash, session()),
    ]);
    expect(results.sort()).toEqual([false, true]);
    const { rows } = await pool.query('SELECT id, revoked_at FROM auth_sessions');
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === previous.id).revoked_at).toBeInstanceOf(Date);
    expect(rows.filter(row => row.revoked_at === null)).toHaveLength(1);
  });

  it.each(['expired', 'revoked', 'wrong-user', 'missing'])('cannot rotate a %s session', async (state) => {
    const previous = session();
    if (state === 'expired') previous.expiresAt = new Date(0);
    if (state !== 'missing') await repository.createSession(previous);
    if (state === 'revoked') await pool.query('UPDATE auth_sessions SET revoked_at = NOW()');
    expect(await repository.rotateSession(previous.tokenHash, session(state === 'wrong-user' ? randomUUID() : profile.id))).toBe(false);
    expect((await pool.query('SELECT id FROM auth_sessions')).rows).toHaveLength(state === 'missing' ? 0 : 1);
  });

  it('rolls back revocation when the replacement insert fails', async () => {
    const previous = session();
    await repository.createSession(previous);
    await expect(repository.rotateSession(previous.tokenHash, { ...session(), id: previous.id }))
      .rejects.toMatchObject({ code: '23505' });
    expect((await pool.query('SELECT revoked_at FROM auth_sessions WHERE id = $1', [previous.id])).rows)
      .toEqual([{ revoked_at: null }]);
    expect(await repository.rotateSession(previous.tokenHash, session())).toBe(true);
  });
});
