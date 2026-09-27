param([switch]$IncludeE2E)
$ErrorActionPreference = 'Stop'
function Invoke-Checked([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Invoke-Checked { node scripts/phase10-contract.test.mjs }
  Invoke-Checked { npm run lint }
  Invoke-Checked { npm --prefix backend run typecheck }
  Invoke-Checked { npm --prefix backend run typecheck:test }
  Invoke-Checked { npm --prefix frontend run typecheck }
  Invoke-Checked { npm --prefix backend test -- --runInBand }
  Invoke-Checked { npm --prefix frontend test -- --run }
  Invoke-Checked { npm run build }
  Invoke-Checked { python -m pytest -q simulator/tests }
  Push-Location ai
  try { Invoke-Checked { python -m pytest -q tests } } finally { Pop-Location }
  Invoke-Checked { npm audit --omit=dev --audit-level=high }
  if ($IncludeE2E) { Invoke-Checked { node scripts/e2e-propulsion-leak.mjs } }
} finally { Pop-Location }
