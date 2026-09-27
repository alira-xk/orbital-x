from pathlib import Path
from app.investigation.migration import run_phase7_migration

async def initialize_phase7(pool, docs_dir: Path, rag, migrate=run_phase7_migration) -> int:
    await migrate(pool)
    count=0
    for path in sorted(docs_dir.glob("*.md")):
        count += await rag.ingest(path.name,path.read_text(encoding="utf-8"))
    return count
