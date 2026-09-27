import type { Pool } from 'pg';
import type { AuthAccount, AuthRepository, AuthSession } from './types.js';

interface AccountRow {
  id: string;
  username: string;
  email: string;
  role: string;
  password_hash: string;
  is_active: boolean | null;
}

function account(row: AccountRow | undefined): AuthAccount | null {
  if (!row) return null;
  return {
    id: row.id, username: row.username, email: row.email, role: row.role,
    passwordHash: row.password_hash, isActive: row.is_active === true,
  };
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async findByLogin(login: string): Promise<AuthAccount | null> {
    const { rows } = await this.database.query<AccountRow>(`
      SELECT id, username, email, role, password_hash, is_active
      FROM users WHERE username = $1 OR email = $1 LIMIT 2
    `, [login]);
    // A username can equal another account's email; never choose an arbitrary user.
    return rows.length === 1 ? account(rows[0]) : null;
  }

  async findById(id: string): Promise<AuthAccount | null> {
    const { rows } = await this.database.query<AccountRow>(`
      SELECT id, username, email, role, password_hash, is_active FROM users WHERE id = $1
    `, [id]);
    return account(rows[0]);
  }

  async createSession(session: AuthSession): Promise<void> {
    await this.database.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)
    `, [session.id, session.userId, session.tokenHash, session.expiresAt]);
  }

  async rotateSession(previousHash: string, session: AuthSession): Promise<boolean> {
    // One statement makes revocation and replacement atomic. PostgreSQL rechecks
    // the predicate after a competing UPDATE releases the old session's row lock.
    const { rows } = await this.database.query<{ id: string }>(`
      WITH revoked AS (
        UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        RETURNING user_id
      )
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
      SELECT $3, user_id, $4, $5 FROM revoked
      RETURNING id
    `, [previousHash, session.userId, session.id, session.tokenHash, session.expiresAt]);
    return rows.length === 1;
  }
}
