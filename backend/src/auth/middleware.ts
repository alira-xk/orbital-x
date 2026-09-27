import type { Request, RequestHandler } from 'express';
import { ServiceUnavailableError } from '../utils/errors.js';
import type { AuthService } from './service.js';

export function readAuthCookie(req: Request, name: string): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';')
    .map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  try {
    return decodeURIComponent(matches[0].slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function requireAuth(service?: AuthService): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!service) throw new ServiceUnavailableError('Authentication storage is unavailable');
      req.user = await service.me(readAuthCookie(req, 'access_token'));
      next();
    } catch (error) {
      next(error);
    }
  };
}
