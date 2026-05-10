# Socrate

Interface de pensée locale avec IA — Electron + React + FastAPI + Ollama + ChromaDB.

## Prérequis

- [Node.js](https://nodejs.org) v20+
- [Python](https://python.org) 3.11+
- [Ollama](https://ollama.com) avec les modèles `llama3.2` et `nomic-embed-text`

## Lancer en développement

**Backend**
```bash
cd server && bash start.sh
```

**Frontend**
```bash
npm install
npm run dev
```

Ouvrir `http://localhost:5173`

## Build Electron

```bash
npm run dist
```

Les fichiers sont générés dans `release/`.
