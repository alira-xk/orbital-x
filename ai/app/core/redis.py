import redis.asyncio as aioredis
import structlog
from typing import Optional

logger = structlog.get_logger()

_redis: Optional[aioredis.Redis] = None


async def init_redis() -> None:
    """Initialize Redis connection."""
    global _redis

    from app.core.config import get_settings

    settings = get_settings()

    _redis = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )

    await _redis.ping()
    logger.info("Redis connected")


async def close_redis() -> None:
    """Close Redis connection."""
    global _redis

    if _redis:
        await _redis.close()
        _redis = None
        logger.info("Redis closed")


async def get_redis() -> aioredis.Redis:
    """Get Redis client instance."""
    global _redis

    if _redis is None:
        await init_redis()

    return _redis
