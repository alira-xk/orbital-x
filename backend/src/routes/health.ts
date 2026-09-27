import { Router } from 'express';
import { pool } from '../config/database.js';
import { redis } from '../config/redis.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'orbital-x-backend',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/ready', async (_req, res) => {
  const checks: Record<string, boolean> = {
    database: false,
    redis: false,
  };

  try {
    await pool.query('SELECT 1');
    checks.database = true;
  } catch {
    // Database check failed
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    // Redis check failed
  }

  const allHealthy = Object.values(checks).every(Boolean);

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/live', (_req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

export default router;
