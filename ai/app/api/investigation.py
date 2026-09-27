from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from app.core.config import settings
from app.core.database import get_pool
from app.investigation.providers import create_provider
from app.investigation.repository import PostgresInvestigationRepository
from app.investigation.service import InvestigationService
from app.investigation.tools import EvidenceTools
from app.rag.embeddings import SentenceTransformerEmbedder
from app.rag.repository import PostgresRagRepository
from app.rag.service import RagService

router = APIRouter()

class InvestigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    incident_id: UUID

async def services():
    pool=await get_pool(); repository=PostgresInvestigationRepository(pool)
    rag=RagService(PostgresRagRepository(pool),SentenceTransformerEmbedder(settings.RAG_EMBEDDING_MODEL),settings.RAG_CHUNK_SIZE,settings.RAG_CHUNK_OVERLAP)
    return repository,EvidenceTools(pool),rag

@router.post("/start")
async def start_investigation(request: InvestigationRequest):
    try:
        repository,tools,rag=await services()
        record=await InvestigationService(repository,tools,rag,create_provider(settings)).run(str(request.incident_id))
        return record.model_dump(mode="json")
    except LookupError as error: raise HTTPException(404,str(error)) from error
    except ValueError as error: raise HTTPException(503,str(error)) from error

@router.get("/{investigation_id}")
async def get_investigation(investigation_id: UUID):
    repository,_,_=await services(); record=await repository.get(str(investigation_id))
    if not record: raise HTTPException(404,"Investigation not found")
    return record

@router.get("/incident/{incident_id}/history")
async def list_investigations(incident_id: UUID, limit: int = 20):
    if limit < 1 or limit > 50: raise HTTPException(422,"limit must be between 1 and 50")
    repository,_,_=await services()
    return await repository.list(str(incident_id),limit)
