import { Router } from 'express';
import { z } from 'zod';
import type { TelemetryReadRepository } from '../telemetry/repository.js';
import { ServiceUnavailableError, ValidationError } from '../utils/errors.js';

const spacecraftParamsSchema = z.object({
  spacecraftId: z.string().trim().min(1).max(100),
});

const historyQuerySchema = z.object({
  metric: z.string().trim().min(1).max(100),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  bucketSeconds: z.coerce.number().pipe(z.union([
    z.literal(2),
    z.literal(5),
    z.literal(15),
    z.literal(60),
    z.literal(300),
  ])).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
}).superRefine((query, context) => {
  if (query.from !== undefined && query.to !== undefined && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: 'from must be earlier than or equal to to',
    });
  }
});

function parseRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError('Invalid telemetry request');
  }
  return result.data;
}

function requireRepository(repository?: TelemetryReadRepository): TelemetryReadRepository {
  if (repository === undefined) {
    throw new ServiceUnavailableError('Telemetry storage is unavailable');
  }
  return repository;
}

function forwardReadError(error: unknown, next: (error: Error) => void): void {
  if (error instanceof ValidationError || error instanceof ServiceUnavailableError) {
    next(error);
    return;
  }
  next(new ServiceUnavailableError('Telemetry storage is unavailable'));
}

export function createTelemetryRouter(repository?: TelemetryReadRepository): Router {
  const router = Router();

  router.get('/latest/:spacecraftId', async (req, res, next) => {
    try {
      const { spacecraftId } = parseRequest(spacecraftParamsSchema, req.params);
      const data = await requireRepository(repository).latest(spacecraftId);
      res.json({ success: true, data });
    } catch (error) {
      forwardReadError(error, next);
    }
  });

  router.get('/history/:spacecraftId', async (req, res, next) => {
    try {
      const { spacecraftId } = parseRequest(spacecraftParamsSchema, req.params);
      const query = parseRequest(historyQuerySchema, req.query);
      const data = await requireRepository(repository).history({ spacecraftId, ...query });
      res.json({ success: true, data });
    } catch (error) {
      forwardReadError(error, next);
    }
  });

  return router;
}
