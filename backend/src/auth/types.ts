import type { AuthUser } from '../incident/types.js';

export type { AuthUser } from '../incident/types.js';

export interface AuthAccount extends AuthUser {
  email: string;
  passwordHash: string;
  isActive: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthRepository {
  findByLogin(login: string): Promise<AuthAccount | null>;
  findById(id: string): Promise<AuthAccount | null>;
  createSession(session: AuthSession): Promise<void>;
  rotateSession(previousHash: string, session: AuthSession): Promise<boolean>;
}

export interface AuthTokens {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
