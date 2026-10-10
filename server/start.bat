@echo off
setlocal
cd /d "%~dp0"

rem Recree le venv s'il est absent ou si son interpreteur ne demarre plus
rem (Python de base desinstalle, venv copie depuis une autre machine...).
".venv\Scripts\python.exe" -c "import sys" >nul 2>&1
if errorlevel 1 (
  echo Creation de l'environnement virtuel...
  if exist ".venv" rmdir /s /q ".venv"
  python -m venv .venv
)

rem "python -m" plutot que pip.exe / uvicorn.exe : ces lanceurs contiennent le
rem chemin absolu du venv et cassent si le projet est deplace.
echo Installation des dependances...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt

echo Demarrage du serveur sur http://localhost:8000
".venv\Scripts\python.exe" -m uvicorn main:app --port 8000
