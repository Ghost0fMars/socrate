@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv" (
  echo Création de l'environnement virtuel...
  python -m venv .venv
)

echo Installation des dépendances...
.venv\Scripts\pip install -q -r requirements.txt

echo Démarrage du serveur sur http://localhost:8000
.venv\Scripts\uvicorn main:app --port 8000
