from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from app.core.config import settings
from app.core.database import get_pool
from app.rag.embeddings import SentenceTransformerEmbedder
from app.rag.repository import PostgresRagRepository
from app.rag.service import RagService

router = APIRouter()


class DocumentIngestRequest(BaseModel):
    content: str
    source: str
    metadata: dict = {}


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.post("/ingest")
async def ingest_document(request: DocumentIngestRequest):
    """Ingest a document into the RAG knowledge base."""
    pool = await get_pool()
    service = RagService(PostgresRagRepository(pool), SentenceTransformerEmbedder(settings.RAG_EMBEDDING_MODEL), settings.RAG_CHUNK_SIZE, settings.RAG_CHUNK_OVERLAP)
    count = await service.ingest(request.source, request.content)
    return {"status": "completed", "chunks": count}


@router.post("/search")
async def search_documents(request: SearchRequest):
    """Search the RAG knowledge base."""
    pool = await get_pool()
    service = RagService(PostgresRagRepository(pool), SentenceTransformerEmbedder(settings.RAG_EMBEDDING_MODEL), settings.RAG_CHUNK_SIZE, settings.RAG_CHUNK_OVERLAP)
    return [item.model_dump() for item in await service.search(request.query, request.top_k)]
