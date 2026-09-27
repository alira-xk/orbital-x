from app.rag.service import DocumentChunk


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


class PostgresRagRepository:
    def __init__(self, pool):
        self.pool = pool

    async def replace_source(self, source: str, chunks: list[DocumentChunk]) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                fingerprints = [chunk.fingerprint for chunk in chunks]
                for chunk in chunks:
                    await connection.execute(
                        """INSERT INTO documentation_chunks(source, section, content, metadata, fingerprint, embedding)
                        VALUES($1,$2,$3,'{}'::jsonb,$4,$5::vector)
                        ON CONFLICT (source, fingerprint) WHERE fingerprint IS NOT NULL
                        DO UPDATE SET section=EXCLUDED.section, content=EXCLUDED.content, embedding=EXCLUDED.embedding""",
                        source, chunk.section, chunk.content, chunk.fingerprint, vector_literal(chunk.embedding or []),
                    )
                await connection.execute(
                    "DELETE FROM documentation_chunks WHERE source=$1 AND NOT (fingerprint = ANY($2::text[]))",
                    source, fingerprints,
                )

    async def search(self, vector: list[float], top_k: int) -> list[dict]:
        rows = await self.pool.fetch(
            """SELECT source, section, content, fingerprint,
            GREATEST(0, LEAST(1, 1 - (embedding <=> $1::vector)))::float8 AS similarity
            FROM documentation_chunks WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector LIMIT $2""",
            vector_literal(vector), top_k,
        )
        return [dict(row) for row in rows]
