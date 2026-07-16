@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creation de l'environnement virtuel...
  if exist ".venv" rmdir /s /q ".venv"
  python -m venv .venv
)

echo Installation des dependances...
".venv\Scripts\pip.exe" install -q -r requirements.txt

echo Demarrage du serveur sur http://localhost:8000
".venv\Scripts\uvicorn.exe" main:app --port 8000
