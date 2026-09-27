import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config/index.js';
import { readAuthCookie, requireAuth } from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import type { AuthTokens } from '../auth/types.js';
import { RateLimitError, ServiceUnavailableError, ValidationError } from '../utils/errors.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  password: z.string().min(1).max(72),
}).strict().refine(body => Boolean(body.username) !== Boolean(body.email));

function setAuthCookies(res: Response, tokens: AuthTokens): void {
  const options = { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'strict' as const };
  res.cookie('access_token', tokens.accessToken, { ...options, path: '/', expires: tokens.accessExpiresAt });
  res.cookie('refresh_token', tokens.refreshToken, { ...options, path: '/api/auth', expires: tokens.refreshExpiresAt });
  res.setHeader('Cache-Control', 'no-store');
}

export function createAuthRouter(service?: AuthService): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: config.rateLimit.authWindowMs,
    limit: config.rateLimit.authMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    // Untrusted forwarded headers are deliberately ignored by Express; their
    // presence on a direct request is not a proxy configuration error.
    validate: { xForwardedForHeader: false },
    handler: (_req, _res, next) => next(new RateLimitError()),
  });
  router.post('/login', limiter, async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid login request');
      if (!service) throw new ServiceUnavailableError('Authentication storage is unavailable');
      const tokens = await service.login(parsed.data.username ?? parsed.data.email!, parsed.data.password);
      setAuthCookies(res, tokens);
      res.json({ success: true, data: tokens.user });
    } catch (error) {
      next(error);
    }
  });
  router.post('/refresh', async (req, res, next) => {
    try {
      if (!service) throw new ServiceUnavailableError('Authentication storage is unavailable');
      const tokens = await service.refresh(readAuthCookie(req, 'refresh_token'));
      setAuthCookies(res, tokens);
      res.json({ success: true, data: tokens.user });
    } catch (error) {
      next(error);
    }
  });
  router.get('/me', requireAuth(service), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: req.user });
  });
  return router;
}
