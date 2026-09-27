import os
import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from app.api import health, investigation, rag, tools
from app.core.config import settings
from app.core.database import init_database, close_database, get_pool
from app.core.redis import init_redis, close_redis
from app.rag.embeddings import SentenceTransformerEmbedder
from app.rag.repository import PostgresRagRepository
from app.rag.service import RagService
from app.runtime import initialize_phase7

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting ORBITAL-X AI Service", version=settings.VERSION)

    # Initialize connections
    try:
        await init_database()
        logger.info("Database connection established")
        pool = await get_pool()
        rag = RagService(PostgresRagRepository(pool), SentenceTransformerEmbedder(settings.RAG_EMBEDDING_MODEL), settings.RAG_CHUNK_SIZE, settings.RAG_CHUNK_OVERLAP)
        chunks = await initialize_phase7(pool, settings.DOCS_DIR, rag)
        logger.info("Phase 7 knowledge base ready", chunks=chunks)
    except Exception as e:
        logger.warning("Database connection failed", error=str(e))

    try:
        await init_redis()
        logger.info("Redis connection established")
    except Exception as e:
        logger.warning("Redis connection failed", error=str(e))

    yield

    # Cleanup
    await close_database()
    await close_redis()
    logger.info("ORBITAL-X AI Service shutdown complete")


app = FastAPI(
    title="ORBITAL-X AI Service",
    description="AI-powered investigation and RAG for spacecraft mission control",
    version=settings.VERSION,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", path=request.url.path, error=str(exc))
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.DEBUG else "An unexpected error occurred",
        },
    )


# Include routers
app.include_router(health.router, prefix="/health", tags=["Health"])
app.include_router(investigation.router, prefix="/api/investigation", tags=["Investigation"])
app.include_router(rag.router, prefix="/api/rag", tags=["RAG"])
app.include_router(tools.router, prefix="/api/tools", tags=["Tools"])


@app.get("/health")
async def health_simple():
    """Simple health check at root level for easier integration."""
    return {
        "status": "healthy",
        "service": "orbital-x-ai",
        "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
    }


@app.get("/")
async def root():
    return {
        "service": "ORBITAL-X AI Service",
        "version": settings.VERSION,
        "status": "running",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG,
    )
