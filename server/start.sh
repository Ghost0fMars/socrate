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

echo "Démarrage du serveur sur http://localhost:8000"
.venv/bin/uvicorn main:app --port 8000
