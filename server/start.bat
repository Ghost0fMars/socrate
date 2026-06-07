@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv" (
  echo Création de l'environnement virtuel...
  python -m venv .venv
)

echo Installation des dépendances...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt

echo Démarrage du serveur sur http://localhost:8000
.venv\Scripts\python.exe -m uvicorn main:app --port 8000
