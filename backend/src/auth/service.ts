import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { ServiceUnavailableError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import type { AuthAccount, AuthRepository, AuthSession, AuthTokens, AuthUser } from './types.js';

// Unknown users still take a bcrypt verification path without storing a fixture credential.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), 12);
const developmentSecrets = new Set([
  'change-this-secret-in-production',
  'your-super-secret-jwt-key-change-this-in-production',
]);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function profile(account: AuthAccount): AuthUser {
  return { id: account.id, username: account.username, role: account.role };
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly settings: typeof config.jwt = config.jwt,
  ) {
    if (config.nodeEnv === 'production' && (typeof settings.secret !== 'string' ||
        !settings.secret.trim() || developmentSecrets.has(settings.secret.trim()))) {
      throw new Error('Production authentication requires a configured, non-default JWT secret');
    }
  }

  async login(login: string, password: string): Promise<AuthTokens> {
    if (typeof login !== 'string' || !login.trim() || login.length > 255 ||
        typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
      throw new ValidationError('Invalid login request');
    }
    const account = await this.storage(() => this.repository.findByLogin(login.trim()));
    const validPassword = await bcrypt.compare(password, account?.passwordHash ?? await dummyHash);
    if (!validPassword || !account?.isActive) throw new UnauthorizedError('Invalid credentials');
    const { tokens, session } = this.issue(account);
    await this.storage(() => this.repository.createSession(session));
    return tokens;
  }

  async refresh(token: string | undefined): Promise<AuthTokens> {
    const claims = this.verify(token, 'refresh');
    const account = await this.activeAccount(claims.sub!);
    const { tokens, session } = this.issue(account);
    const rotated = await this.storage(() => this.repository.rotateSession(hashToken(token!), session));
    if (!rotated) throw new UnauthorizedError('Invalid refresh session');
    return tokens;
  }

  async me(token: string | undefined): Promise<AuthUser> {
    const claims = this.verify(token, 'access');
    return profile(await this.activeAccount(claims.sub!));
  }

  private verify(token: string | undefined, type: 'access' | 'refresh'): jwt.JwtPayload {
    try {
      if (!token) throw new Error('Missing token');
      const claims = jwt.verify(token, this.settings.secret, { algorithms: ['HS256'] });
      if (typeof claims === 'string' || typeof claims.sub !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub) ||
          typeof claims.exp !== 'number' || claims.type !== type ||
          (type === 'refresh' && typeof claims.jti !== 'string') ||
          (type === 'access' && (typeof claims.username !== 'string' || typeof claims.role !== 'string'))) {
        throw new Error('Invalid claims');
      }
      return claims;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }

  private async activeAccount(id: string): Promise<AuthAccount> {
    const account = await this.storage(() => this.repository.findById(id));
    if (!account?.isActive) throw new UnauthorizedError('Invalid authentication');
    return account;
  }

  private issue(account: AuthAccount): { tokens: AuthTokens; session: AuthSession } {
    const user = profile(account);
    const sessionId = randomUUID();
    const accessToken = jwt.sign({ username: user.username, role: user.role, type: 'access' }, this.settings.secret, {
      algorithm: 'HS256', subject: user.id, jwtid: randomUUID(),
      expiresIn: this.settings.expiresIn as jwt.SignOptions['expiresIn'],
    });
    const refreshToken = jwt.sign({ type: 'refresh' }, this.settings.secret, {
      algorithm: 'HS256', subject: user.id, jwtid: sessionId,
      expiresIn: this.settings.refreshExpiresIn as jwt.SignOptions['expiresIn'],
    });
    const accessExpiresAt = new Date((jwt.decode(accessToken) as jwt.JwtPayload).exp! * 1000);
    const refreshExpiresAt = new Date((jwt.decode(refreshToken) as jwt.JwtPayload).exp! * 1000);
    return {
      tokens: { user, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt },
      session: { id: sessionId, userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt },
    };
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new ServiceUnavailableError('Authentication storage is unavailable');
    }
  }
}
