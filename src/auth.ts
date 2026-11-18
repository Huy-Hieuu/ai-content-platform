import type { DatabaseSync } from 'node:sqlite';

import type { OAuthTokenVerifier } from '@modelcontextprotocol/express';
import { type AuthInfo, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

import { hashToken } from './database.ts';

export type Role = 'creator' | 'admin';

export interface User {
  id: string;
  role: Role;
}

/**
 * Checks a bearer token and returns the caller. The local version reads `access_tokens`.
 * In M2 this function verifies a JWT from the OAuth authorization server instead; nothing else changes.
 */
export function createTokenVerifier(db: DatabaseSync): OAuthTokenVerifier {
  const findToken = db.prepare(`
    SELECT u.id, u.role, t.expires_at
    FROM access_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND u.status = 'active'`);

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const row = findToken.get(hashToken(token));
      if (!row) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown token or inactive user');
      const user: User = { id: String(row.id), role: row.role as Role };
      return { token, clientId: user.id, scopes: [], expiresAt: Number(row.expires_at), extra: { user } };
    },
  };
}

export function userFromAuthInfo(authInfo: AuthInfo | undefined): User {
  const user = authInfo?.extra?.user as User | undefined;
  if (!user) throw new Error('Request has no authenticated user. Mount requireBearerAuth before the MCP handler.');
  return user;
}
