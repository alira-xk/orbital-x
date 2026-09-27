import hashlib
import re
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, ConfigDict


class DocumentChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    section: str
    content: str
    fingerprint: str
    embedding: list[float] | None = None


class SearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    section: str
    content: str
    fingerprint: str
    similarity: float


def chunk_markdown(source: str, content: str, size: int, overlap: int) -> list[DocumentChunk]:
    if size < 50 or size > 4000:
        raise ValueError("chunk size must be between 50 and 4000")
    if overlap < 0 or overlap >= size:
        raise ValueError("chunk overlap must be smaller than chunk size")
    sections: list[tuple[str, str]] = []
    heading = "Document"
    body: list[str] = []
    for line in content.splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if match:
            if "\n".join(body).strip():
                sections.append((heading, "\n".join(body).strip()))
            heading, body = match.group(1), []
        else:
            body.append(line)
    if "\n".join(body).strip():
        sections.append((heading, "\n".join(body).strip()))
    chunks: list[DocumentChunk] = []
    step = size - overlap
    for section, text in sections:
        for start in range(0, len(text), step):
            piece = text[start:start + size].strip()
            if not piece:
                continue
            fingerprint = hashlib.sha256(f"{source}\0{section}\0{piece}".encode()).hexdigest()
            chunks.append(DocumentChunk(source=source, section=section, content=piece, fingerprint=fingerprint))
            if start + size >= len(text):
                break
    return chunks


class Repository(Protocol):
    async def replace_source(self, source: str, chunks: list[DocumentChunk]) -> None: ...
    async def search(self, vector: list[float], top_k: int) -> list[dict]: ...


class Embedder(Protocol):
    def encode(self, texts: list[str]) -> list[list[float]]: ...


class RagService:
    def __init__(self, repository: Repository, embedder: Embedder, chunk_size: int = 500, chunk_overlap: int = 50):
        self.repository, self.embedder = repository, embedder
        self.chunk_size, self.chunk_overlap = chunk_size, chunk_overlap

    async def ingest(self, source: str, content: str) -> int:
        chunks = chunk_markdown(source, content, self.chunk_size, self.chunk_overlap)
        vectors = self.embedder.encode([chunk.content for chunk in chunks]) if chunks else []
        embedded = [chunk.model_copy(update={"embedding": vector}) for chunk, vector in zip(chunks, vectors)]
        await self.repository.replace_source(source, embedded)
        return len(embedded)

    async def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        if not query.strip() or len(query) > 2000:
            raise ValueError("query must be between 1 and 2000 characters")
        if top_k < 1 or top_k > 20:
            raise ValueError("top_k must be between 1 and 20")
        rows = await self.repository.search(self.embedder.encode([query])[0], top_k)
        return [SearchResult.model_validate(row) for row in rows]
