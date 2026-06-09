#!/usr/bin/env bash
set -euo pipefail

# Always run from tacit-backend package root (this script's directory).
cd "$(dirname "$0")"

echo "==> Build cwd: $(pwd)"

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found. Set Render Root Directory to tacit-backend (repo root if this is the backend repo)."
  exit 1
fi

npm install
npm run build

if [ -f "requirements.txt" ]; then
  pip install -r requirements.txt
elif [ -f "contract_revrec_poc/requirements.txt" ]; then
  pip install -r contract_revrec_poc/requirements.txt
else
  echo "ERROR: No Python requirements file. Ensure requirements.txt is committed and pushed."
  ls -la
  exit 1
fi

echo "==> Build OK"
