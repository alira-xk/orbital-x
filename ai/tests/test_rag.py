import asyncio

from app.rag.service import RagService, chunk_markdown


class MemoryRepository:
    def __init__(self):
        self.rows = {}

    async def replace_source(self, source, chunks):
        self.rows[source] = list(chunks)

    async def search(self, vector, top_k):
        rows = [chunk for chunks in self.rows.values() for chunk in chunks]
        return [{**chunk.model_dump(exclude={"embedding"}), "similarity": 0.9} for chunk in rows[:top_k]]


class Embedder:
    dimension = 384

    def encode(self, texts):
        return [[1.0] + [0.0] * 383 for _ in texts]


def test_chunk_markdown_preserves_heading_and_stable_fingerprint():
    content = "# Propulsion\n" + "pressure " * 80
    first = chunk_markdown("propulsion.md", content, 120, 20)
    second = chunk_markdown("propulsion.md", content, 120, 20)
    assert first == second
    assert len(first) > 1
    assert all(chunk.section == "Propulsion" for chunk in first)


def test_chunk_markdown_rejects_invalid_overlap():
    try:
        chunk_markdown("x.md", "# X\ntext", 100, 100)
    except ValueError as error:
        assert str(error) == "chunk overlap must be smaller than chunk size"
    else:
        raise AssertionError("invalid overlap accepted")


def test_reingest_replaces_stale_chunks_and_search_is_bounded():
    async def run():
        repository = MemoryRepository()
        service = RagService(repository, Embedder(), chunk_size=120, chunk_overlap=20)
        await service.ingest("propulsion.md", "# Leak\nPressure falls rapidly.")
        await service.ingest("propulsion.md", "# Leak\nPressure stabilizes after isolation.")
        assert len(repository.rows["propulsion.md"]) == 1
        result = await service.search("isolation pressure", 1)
        assert result[0].source == "propulsion.md"
        assert "stabilizes" in result[0].content
        try:
            await service.search("x", 0)
        except ValueError as error:
            assert str(error) == "top_k must be between 1 and 20"
        else:
            raise AssertionError("invalid top_k accepted")

    asyncio.run(run())
