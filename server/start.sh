#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Recrée le venv s'il est absent ou si son interpréteur ne démarre plus
if ! .venv/bin/python -c "import sys" >/dev/null 2>&1; then
  echo "Création de l'environnement virtuel..."
  rm -rf .venv
  python3 -m venv .venv
fi

# "python -m" plutôt que bin/pip / bin/uvicorn : leur shebang contient le chemin
# absolu du venv et casse si le projet est déplacé.
echo "Installation des dépendances..."
.venv/bin/python -m pip install -q -r requirements.txt

# Kill any leftover backend from a previous session
pkill -f "uvicorn main:app" 2>/dev/null || true

echo "Démarrage du serveur sur http://localhost:8000"
.venv/bin/python -m uvicorn main:app --port 8000
