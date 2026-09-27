import { createServer, type Server as HttpServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { db, initializeDatabase, pool } from './config/database.js';
import { initializeRedis, redis } from './config/redis.js';
import { StreamingAnomalyDetector, type AnomalyResult } from './telemetry/anomalyDetection.js';
import { attachTelemetryWebSocketServer, type WebSocketTelemetryBroadcaster } from './telemetry/broadcaster.js';
import { PostgresTelemetryRepository } from './telemetry/repository.js';
import type { TelemetryFrame } from './telemetry/schema.js';
import { TelemetryWorker, type TelemetryRedisClient } from './workers/telemetry-worker.js';
import { logger } from './utils/logger.js';
import { AlertService } from './incident/alertService.js';
import { PostgresAlertRepository, PostgresIncidentRepository } from './incident/repository.js';
import { PostgresAuthRepository } from './auth/repository.js';
import { AuthService } from './auth/service.js';
import { HttpInvestigationClient } from './investigation/client.js';
import { PostgresCommandStore } from './command/repository.js';
import { CommandService } from './command/service.js';
import { RedisCommandDispatcher } from './command/dispatcher.js';
import { CommandResultWorker, type CommandResultRedis } from './workers/command-result-worker.js';

export interface BackendRuntime {
  close(): Promise<void>;
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function closeRuntimePart(label: string, close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch (error) {
    logger.warn({ error: String(error) }, `${label} shutdown failed`);
  }
}

function createAnomalyEvidenceSink(alertService: AlertService): (frame: TelemetryFrame, result: AnomalyResult) => Promise<void> {
  let totalAnomalyCount = 0;

  return async (frame, result): Promise<void> => {
    totalAnomalyCount += result.anomalies.length;
    const anomalies = result.anomalies.map((anomaly) => ({
      metric: anomaly.metric,
      subsystem: anomaly.subsystem,
      value: anomaly.value,
      score: anomaly.score,
      expectedRange: anomaly.expectedRange,
      methods: [...anomaly.methods],
    }));

    logger.warn({
      spacecraftId: frame.spacecraft_id,
      evaluatedAt: result.evaluatedAt,
      severity: result.severity,
      score: result.score,
      anomalyCount: anomalies.length,
      totalAnomalyCount,
      anomalies,
    }, 'Telemetry anomaly evidence detected');

    await alertService.handleEvidence(frame, result);
  };
}

export async function startBackend(): Promise<BackendRuntime> {
  logger.info('Starting ORBITAL-X backend...');

  let databaseAvailable = false;
  try {
    await initializeDatabase();
    databaseAvailable = true;
  } catch (error) {
    logger.warn({ error: String(error) }, 'Database initialization failed - continuing without DB');
  }

  let redisAvailable = false;
  try {
    await initializeRedis();
    redisAvailable = true;
  } catch (error) {
    redis.disconnect();
    logger.warn({ error: String(error) }, 'Redis initialization failed - continuing without Redis');
  }

  const repository = new PostgresTelemetryRepository(db);
  const alertRepository = new PostgresAlertRepository(db);
  const incidentRepository = new PostgresIncidentRepository(db);
  const alertService = new AlertService(db);
  const authService = databaseAvailable ? new AuthService(new PostgresAuthRepository(pool)) : undefined;
  const commandService = databaseAvailable ? new CommandService(new PostgresCommandStore(pool)) : undefined;
  const commandDispatcher = redisAvailable ? new RedisCommandDispatcher(redis, config.commands.streamName) : undefined;
  const app = createApp({
    telemetryRepository: databaseAvailable ? repository : undefined,
    alertRepository: databaseAvailable ? alertRepository : undefined,
    incidentRepository: databaseAvailable ? incidentRepository : undefined,
    authService,
    investigationClient: new HttpInvestigationClient(),
    commandService,
    commandDispatcher,
  });
  const httpServer = createServer(app);
  const broadcaster: WebSocketTelemetryBroadcaster = attachTelemetryWebSocketServer(
    httpServer,
    config.telemetry.websocketPath,
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, resolve);
  });
  logger.info(`ORBITAL-X backend running on http://localhost:${config.port}`);
  logger.info({ env: config.nodeEnv }, 'Environment');
  logger.info(`Health check: http://localhost:${config.port}/health`);

  let worker: TelemetryWorker | undefined;
  let workerConsumption: Promise<void> | undefined;
  let workerRedis: typeof redis | undefined;
  let commandWorker: CommandResultWorker | undefined;
  let commandWorkerConsumption: Promise<void> | undefined;
  let commandWorkerRedis: typeof redis | undefined;
  if (redisAvailable) {
    workerRedis = redis.duplicate();
    const telemetryRedis = workerRedis as unknown as TelemetryRedisClient;
    const anomalyDetector = new StreamingAnomalyDetector();
    const anomalySink = createAnomalyEvidenceSink(alertService);
    worker = new TelemetryWorker({
      redis: telemetryRedis,
      repository,
      broadcaster,
      anomalyDetector,
      anomalySink,
      streamName: config.telemetry.streamName,
      consumerGroup: config.telemetry.consumerGroup,
      consumerId: config.telemetry.consumerId,
    });
    workerConsumption = worker.consume().catch((error) => {
      logger.error({ error: String(error) }, 'Telemetry worker stopped unexpectedly');
    });
    if (commandService) {
      commandWorkerRedis = redis.duplicate();
      commandWorker = new CommandResultWorker(commandWorkerRedis as unknown as CommandResultRedis, commandService, config.commands.resultStreamName, config.commands.resultGroup);
      commandWorkerConsumption = commandWorker.consume().catch(error => logger.error({error:String(error)},'Command result worker stopped unexpectedly'));
    }
  }

  let closed = false;
  return {
    close: async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;

      worker?.stop();
      commandWorker?.stop();
      const consumption = workerConsumption;
      if (consumption !== undefined) {
        await closeRuntimePart('Telemetry worker', () => consumption);
      }
      if (workerRedis !== undefined) {
        await closeRuntimePart('Telemetry worker Redis', async () => {
          await workerRedis?.quit();
        });
      }
      if (commandWorkerConsumption) await closeRuntimePart('Command result worker',()=>commandWorkerConsumption!);
      if (commandWorkerRedis) await closeRuntimePart('Command result worker Redis',async()=>{await commandWorkerRedis?.quit();});
      await closeRuntimePart('WebSocket server', () => broadcaster.close());
      await closeRuntimePart('HTTP server', () => closeHttpServer(httpServer));
      if (redisAvailable) {
        await closeRuntimePart('Redis', async () => {
          await redis.quit();
        });
      }
      await closeRuntimePart('PostgreSQL', () => pool.end());
      worker = undefined;
      workerConsumption = undefined;
      workerRedis = undefined;
      commandWorker = undefined;
      commandWorkerConsumption = undefined;
      commandWorkerRedis = undefined;
    },
  };
}

if (require.main === module) {
  const runtimePromise = startBackend();
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully`);
    try {
      const runtime = await runtimePromise;
      await runtime.close();
      process.exit(0);
    } catch (error) {
      logger.error({ error: String(error) }, 'Failed to shut down server');
      process.exit(1);
    }
  };

  void runtimePromise.catch((error) => {
    logger.error({ error: String(error) }, 'Failed to start server');
    process.exit(1);
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
