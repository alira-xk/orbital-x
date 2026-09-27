PHASE7_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE documentation_chunks ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE documentation_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_source_fingerprint
  ON documentation_chunks(source, fingerprint) WHERE fingerprint IS NOT NULL;
ALTER TABLE ai_investigations ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE ai_investigations ADD COLUMN IF NOT EXISTS model TEXT;
"""


async def run_phase7_migration(pool) -> None:
    async with pool.acquire() as connection:
        await connection.execute(PHASE7_SQL)
