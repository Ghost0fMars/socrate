#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d ".venv" ]; then
  echo "Création de l'environnement virtuel..."
  python3 -m venv .venv
fi

echo "Installation des dépendances..."
.venv/bin/pip install -q -r requirements.txt

# Kill any leftover backend from a previous session
pkill -f "uvicorn main:app" 2>/dev/null || true

echo "Démarrage du serveur sur http://localhost:8000"
.venv/bin/uvicorn main:app --port 8000
