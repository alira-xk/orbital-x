import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import type { IncidentRepository } from '../incident/repository.js';
import { parseInvestigation, type InvestigationClient } from '../investigation/types.js';
import { AlertSeverity, IncidentStatus } from '../incident/types.js';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../utils/errors.js';

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const boundsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const incidentQuerySchema = boundsSchema.extend({
  spacecraftId: z.string().trim().min(1).max(100).optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
}).strict();
const detailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
}).strict();
const transitionSchema = z.object({
  expectedStatus: z.nativeEnum(IncidentStatus),
}).strict();
const statusSchema = transitionSchema.extend({ status: z.nativeEnum(IncidentStatus) }).strict();
const commentSchema = z.object({ comment: z.string().trim().min(1).max(2000) }).strict();
const investigationQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();

function parse<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError('Invalid incident request');
  return result.data;
}

function requireRepository(repository?: IncidentRepository): IncidentRepository {
  if (!repository) throw new ServiceUnavailableError('Incident storage is unavailable');
  return repository;
}

function storageError(error: unknown): Error {
  return error instanceof ValidationError
    || error instanceof NotFoundError
    || error instanceof ConflictError
    || error instanceof ServiceUnavailableError
    ? error
    : new ServiceUnavailableError('Incident storage is unavailable');
}

export function createIncidentsRouter(repository?: IncidentRepository, authService?: AuthService, investigationClient?: InvestigationClient): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const query = parse(incidentQuerySchema, req.query);
      res.json({ success: true, data: await requireRepository(repository).list(query) });
    } catch (error) {
      next(storageError(error));
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = parse(paramsSchema, req.params);
      const { limit } = parse(detailQuerySchema, req.query);
      const data = await requireRepository(repository).detail(id, limit);
      if (!data) throw new NotFoundError('Incident not found');
      res.json({ success: true, data });
    } catch (error) {
      next(storageError(error));
    }
  });

  router.get('/:id/replay', async (req, res, next) => {
    try {
      const { id } = parse(paramsSchema, req.params);
      const data = await requireRepository(repository).replay(id);
      if (!data) throw new NotFoundError('Incident not found');
      res.json({ success: true, data });
    } catch (error) { next(storageError(error)); }
  });

  const authenticated = requireAuth(authService);

  router.get('/:id/investigations', async (req,res,next)=>{
    try {
      const {id}=parse(paramsSchema,req.params); const {limit}=parse(investigationQuerySchema,req.query);
      if(!investigationClient) throw new ServiceUnavailableError('AI investigation service is unavailable');
      if(!await requireRepository(repository).detail(id,1)) throw new NotFoundError('Incident not found');
      const value=await investigationClient.list(id,limit);
      if(!Array.isArray(value)) throw new Error('Malformed AI response');
      res.json({success:true,data:value.map(parseInvestigation)});
    } catch(error){ next(storageError(error)); }
  });

  router.post('/:id/investigations', authenticated, async (req,res,next)=>{
    try {
      const {id}=parse(paramsSchema,req.params);
      if(!investigationClient) throw new ServiceUnavailableError('AI investigation service is unavailable');
      if(!await requireRepository(repository).detail(id,1)) throw new NotFoundError('Incident not found');
      res.json({success:true,data:parseInvestigation(await investigationClient.start(id))});
    } catch(error){ next(storageError(error)); }
  });

  async function transition(
    req: Request,
    res: Response,
    next: NextFunction,
    targetStatus?: IncidentStatus,
  ): Promise<void> {
    try {
      const { id } = parse(paramsSchema, req.params);
      const { expectedStatus, status } = targetStatus === undefined
        ? parse(statusSchema, req.body)
        : { ...parse(transitionSchema, req.body), status: targetStatus };
      const incidents = requireRepository(repository);
      const data = await incidents.transition(id, expectedStatus, status, req.user!.id);
      if (!data) {
        if (!await incidents.detail(id, 1)) throw new NotFoundError('Incident not found');
        throw new ConflictError('Incident status transition conflicts with current state');
      }
      res.json({ success: true, data });
    } catch (error) {
      next(storageError(error));
    }
  }

  router.post('/:id/acknowledge', authenticated, (req, res, next) => {
    void transition(req, res, next, IncidentStatus.ACKNOWLEDGED);
  });

  router.post('/:id/status', authenticated, async (req, res, next) => {
    await transition(req, res, next);
  });

  router.post('/:id/comments', authenticated, async (req, res, next) => {
    try {
      const { id } = parse(paramsSchema, req.params);
      const { comment } = parse(commentSchema, req.body);
      const data = await requireRepository(repository).comment(id, req.user!.id, comment);
      if (!data) throw new NotFoundError('Incident not found');
      res.json({ success: true, data });
    } catch (error) {
      next(storageError(error));
    }
  });

  router.post('/:id/resolve', authenticated, (req, res, next) => {
    void transition(req, res, next, IncidentStatus.RESOLVED);
  });

  return router;
}
