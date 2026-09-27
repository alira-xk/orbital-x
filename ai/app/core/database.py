import asyncpg
import structlog
from typing import Optional

logger = structlog.get_logger()

_pool: Optional[asyncpg.Pool] = None


async def init_database() -> None:
    """Initialize PostgreSQL connection pool."""
    global _pool

    from app.core.config import get_settings

    settings = get_settings()

    _pool = await asyncpg.create_pool(
        settings.DATABASE_URL,
        min_size=2,
        max_size=10,
    )

    logger.info("Database pool created")


async def close_database() -> None:
    """Close database connection pool."""
    global _pool

    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed")


async def get_pool() -> asyncpg.Pool:
    """Get database pool instance."""
    global _pool

    if _pool is None:
        await init_database()

    return _pool


async def query(query: str, *args) -> list[dict]:
    """Execute a query and return results as list of dicts."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *args)
        return [dict(r) for r in rows]


async def query_one(statement: str, *args) -> Optional[dict]:
    """Execute a query and return first result as dict."""
    rows = await query(statement, *args)
    return rows[0] if rows else None
