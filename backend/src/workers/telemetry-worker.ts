import { TelemetryFrameSchema, toTelemetryFrame, type TelemetryFrame } from '../telemetry/schema.js';
import type { TelemetryRepository } from '../telemetry/repository.js';
import type { AnomalyResult } from '../telemetry/anomalyDetection.js';
import { logger } from '../utils/logger.js';

const MAX_PENDING_ANOMALY_RESULTS = 100;

export type TelemetryStreamEntry = [entryId: string, fields: string[]];
export type TelemetryStreamReadResult = Array<[
  streamName: string,
  entries: TelemetryStreamEntry[],
]> | null;

export interface TelemetryRedisClient {
  xgroup(...args: Array<string | number>): Promise<unknown>;
  xreadgroup(...args: Array<string | number>): Promise<TelemetryStreamReadResult>;
  xack(streamName: string, groupName: string, ...entryIds: string[]): Promise<number>;
}

export interface TelemetryBroadcaster {
  broadcast(frame: TelemetryFrame): Promise<void>;
}

export interface TelemetryWorkerDependencies {
  redis: TelemetryRedisClient;
  repository: TelemetryRepository;
  broadcaster: TelemetryBroadcaster;
  anomalyDetector?: { detect(frame: TelemetryFrame): AnomalyResult };
  anomalySink?: (frame: TelemetryFrame, result: AnomalyResult) => Promise<void>;
  streamName?: string;
  consumerGroup?: string;
  consumerId?: string;
}

export class TelemetryWorker {
  private readonly streamName: string;
  private readonly consumerGroup: string;
  private readonly consumerId: string;
  private readonly pendingAnomalyResults = new Map<string, AnomalyResult>();
  private stopped = false;

  constructor(private readonly dependencies: TelemetryWorkerDependencies) {
    this.streamName = dependencies.streamName ?? 'telemetry:stream';
    this.consumerGroup = dependencies.consumerGroup ?? 'telemetry-workers';
    this.consumerId = dependencies.consumerId ?? 'telemetry-worker';
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.dependencies.redis.xgroup(
        'CREATE',
        this.streamName,
        this.consumerGroup,
        '$',
        'MKSTREAM',
      );
      logger.info({ stream: this.streamName, group: this.consumerGroup }, 'Telemetry consumer group created');
    } catch (error) {
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        return;
      }
      logger.error(
        {
          err: error,
          stream: this.streamName,
          group: this.consumerGroup,
          consumer: this.consumerId,
        },
        'Telemetry consumer group creation failed',
      );
      throw error;
    }
  }

  async consume(): Promise<void> {
    if (this.stopped) {
      return;
    }
    await this.ensureGroup();
    logger.info(
      { stream: this.streamName, group: this.consumerGroup, consumer: this.consumerId },
      'Telemetry worker started',
    );

    while (!this.stopped) {
      try {
        await this.consumeOnce();
      } catch (error) {
        if (this.stopped) {
          return;
        }
        logger.error({ err: error }, 'Telemetry worker processing failed; entry remains pending');
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  async consumeOnce(): Promise<void> {
    const pendingFailure = await this.processStreams(await this.dependencies.redis.xreadgroup(
      'GROUP',
      this.consumerGroup,
      this.consumerId,
      'COUNT',
      100,
      'STREAMS',
      this.streamName,
      '0',
    ));
    const remainingCapacity = MAX_PENDING_ANOMALY_RESULTS - this.pendingAnomalyResults.size;
    const newFailure = remainingCapacity > 0
      ? await this.processStreams(await this.dependencies.redis.xreadgroup(
        'GROUP',
        this.consumerGroup,
        this.consumerId,
        'BLOCK',
        1000,
        'COUNT',
        remainingCapacity,
        'STREAMS',
        this.streamName,
        '>',
      ))
      : undefined;

    if (pendingFailure !== undefined) {
      throw pendingFailure;
    }
    if (newFailure !== undefined) {
      throw newFailure;
    }
  }

  private async processStreams(streams: TelemetryStreamReadResult): Promise<unknown | undefined> {
    let firstFailure: unknown | undefined;
    if (streams === null) {
      return firstFailure;
    }
    for (const [, entries] of streams) {
      for (const [entryId, fields] of entries) {
        if (this.pendingAnomalyResults.size >= MAX_PENDING_ANOMALY_RESULTS
          && !this.pendingAnomalyResults.has(entryId)) continue;
        try {
          await this.processEntry(entryId, fields);
        } catch (error) {
          firstFailure ??= error;
          logger.error({ err: error, entryId }, 'Telemetry batch entry failed; continuing remaining entries');
        }
      }
    }
    return firstFailure;
  }

  async processEntry(entryId: string, fields: string[]): Promise<void> {
    const rawFrame = this.readTelemetryFrame(fields);
    if (rawFrame === null) {
      await this.discardInvalid(entryId, 'entry must contain exactly one telemetry:frame string field');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawFrame);
    } catch (error) {
      await this.discardInvalid(entryId, 'telemetry:frame contains malformed JSON', error);
      return;
    }

    const parsedFrame = TelemetryFrameSchema.safeParse(parsedJson);
    if (!parsedFrame.success) {
      await this.discardInvalid(entryId, 'telemetry:frame failed schema validation', parsedFrame.error);
      return;
    }

    const frame = toTelemetryFrame(parsedFrame.data.payload);

    try {
      await this.dependencies.repository.store(frame);
      let anomalyResult = this.pendingAnomalyResults.get(entryId);
      if (anomalyResult === undefined) {
        anomalyResult = this.dependencies.anomalyDetector?.detect(frame);
        if (anomalyResult !== undefined) this.pendingAnomalyResults.set(entryId, anomalyResult);
      }
      if (anomalyResult !== undefined && anomalyResult.anomalies.length > 0) {
        await this.dependencies.anomalySink?.(frame, anomalyResult);
      }
      await this.dependencies.broadcaster.broadcast(frame);
      await this.acknowledge(entryId);
      this.pendingAnomalyResults.delete(entryId);
      logger.debug({ entryId, spacecraftId: frame.spacecraft_id }, 'Telemetry frame processed');
    } catch (error) {
      logger.error({ err: error, entryId }, 'Telemetry processing failed; entry remains pending');
      throw error;
    }
  }

  private readTelemetryFrame(fields: string[]): string | null {
    if (fields.length !== 2 || fields[0] !== 'telemetry:frame' || typeof fields[1] !== 'string') {
      return null;
    }
    return fields[1];
  }

  private async discardInvalid(entryId: string, reason: string, error?: unknown): Promise<void> {
    logger.warn({ err: error, entryId, reason }, 'Discarding invalid telemetry entry');
    await this.acknowledge(entryId);
  }

  private async acknowledge(entryId: string): Promise<void> {
    await this.dependencies.redis.xack(this.streamName, this.consumerGroup, entryId);
  }
}
