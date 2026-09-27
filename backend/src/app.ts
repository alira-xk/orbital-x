import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import healthRouter from './routes/health.js';
import { createTelemetryRouter } from './routes/telemetry.js';
import type { TelemetryReadRepository } from './telemetry/repository.js';
import { createAuthRouter } from './routes/auth.js';
import type { AuthService } from './auth/service.js';
import { ValidationError } from './utils/errors.js';
import type { AlertRepository, IncidentRepository } from './incident/repository.js';
import { createAlertsRouter } from './routes/alerts.js';
import { createIncidentsRouter } from './routes/incidents.js';
import type { InvestigationClient } from './investigation/client.js';
import type { CommandService } from './command/service.js';
import type { CommandDispatcher } from './command/dispatcher.js';
import { createCommandsRouter } from './routes/commands.js';

export interface AppDependencies {
  telemetryRepository?: TelemetryReadRepository;
  authService?: AuthService;
  alertRepository?: AlertRepository;
  incidentRepository?: IncidentRepository;
  investigationClient?: InvestigationClient;
  commandService?: CommandService;
  commandDispatcher?: CommandDispatcher;
}

function createAllowedCorsOrigins(configuredOrigin: string): Set<string> {
  const origins = new Set([configuredOrigin]);

  try {
    const url = new URL(configuredOrigin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      const alias = new URL(configuredOrigin);
      alias.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      origins.add(alias.origin);
    }
  } catch {
    // The CORS middleware will continue to enforce the configured value.
  }

  return origins;
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();
  const allowedCorsOrigins = createAllowedCorsOrigins(config.cors.origin);

  // Only configured proxy addresses may supply the client IP used by rate limits.
  app.set('trust proxy', config.trustedProxies.length > 0 ? config.trustedProxies : false);

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, origin === undefined || allowedCorsOrigins.has(origin));
      },
      credentials: config.cors.credentials,
    })
  );

  // Body parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request ID
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    (req as express.Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Logging
  if (config.nodeEnv === 'development') {
    app.use(
      morgan('dev', {
        stream: { write: (msg) => logger.info(msg.trim()) },
      })
    );
  } else {
    app.use(
      morgan('combined', {
        stream: { write: (msg) => logger.info(msg.trim()) },
      })
    );
  }

  // Health checks
  app.use('/', healthRouter);

  app.use('/api/telemetry', createTelemetryRouter(dependencies.telemetryRepository));
  app.use('/api/auth', createAuthRouter(dependencies.authService));
  app.use('/api/alerts', createAlertsRouter(dependencies.alertRepository));
  app.use('/api/incidents', createIncidentsRouter(dependencies.incidentRepository, dependencies.authService, dependencies.investigationClient));
  app.use('/api', createCommandsRouter(dependencies.commandService, dependencies.authService, dependencies.commandDispatcher));

  // API routes (will be added in later phases)
  // app.use('/api/spacecraft', spacecraftRouter);
  // app.use('/api/commands', commandsRouter);
  // app.use('/api/simulation', simulationRouter);
  // app.use('/api/ai', aiRouter);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.originalUrl} not found`,
      },
    });
  });

  // Error handler
  // Body parsing runs before routers, so sanitize parser errors here.
  const handleBodyError: express.ErrorRequestHandler = (error, req, _res, next) => {
    const message = req.originalUrl.startsWith('/api/auth/') ? 'Invalid login request' : 'Invalid incident request';
    next(error?.type === 'entity.parse.failed' ? new ValidationError(message) : error);
  };
  app.use(['/api/auth', '/api/incidents'], handleBodyError);
  app.use(errorHandler);

  return app;
}
