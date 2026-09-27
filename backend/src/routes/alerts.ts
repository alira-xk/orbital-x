import { Router } from 'express';
import { z } from 'zod';
import type { AlertRepository } from '../incident/repository.js';
import { AlertSeverity, AlertStatus } from '../incident/types.js';
import { ServiceUnavailableError, ValidationError } from '../utils/errors.js';

const alertQuerySchema = z.object({
  spacecraftId: z.string().trim().min(1).max(100).optional(),
  status: z.nativeEnum(AlertStatus).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  subsystem: z.string().trim().min(1).max(100).optional(),
  metric: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((query, context) => {
  if (query.from !== undefined && query.to !== undefined && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: 'from must be earlier than or equal to to',
    });
  }
});

export function createAlertsRouter(repository?: AlertRepository): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const query = alertQuerySchema.safeParse(req.query);
      if (!query.success) throw new ValidationError('Invalid alert request');
      if (!repository) throw new ServiceUnavailableError('Alert storage is unavailable');
      res.json({ success: true, data: await repository.list(query.data) });
    } catch (error) {
      next(error instanceof ValidationError || error instanceof ServiceUnavailableError
        ? error
        : new ServiceUnavailableError('Alert storage is unavailable'));
    }
  });

  return router;
}
