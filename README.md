# 🏛️ Socrate

> **Interface de pensée locale et souveraine avec IA** — Une plateforme d'accompagnement de recherche maïeutique basée sur l'Intégrale Dramatique et le verrouillage rigoureux de corpus. 
> 
> *Construit avec Electron + React + FastAPI + Ollama/OpenAI + Qdrant.*

---

## 🎯 Objectifs de l'Application

**Socrate** n'est pas un assistant conversationnel générique ni un générateur de résumés passifs. C'est un **dispositif pédagogique et dramaturgique fermé**, conçu pour accompagner les chercheurs, écrivains et étudiants dans la conceptualisation de leurs travaux (théorie de l'art, écriture narrative, recherche universitaire, journal de bord).

Ses objectifs s'articulent autour de trois piliers fondamentaux :

### 1. La Posture Maïeutique Pure & Socratique
L'application refuse le confort de la réponse pré-mâchée. Fidèle à la méthode socratique, **Socrate** agit comme un directeur de recherche exigeant :
* **Questionnement déstabilisant :** Il pousse l'étudiant dans ses retranchements sémantiques sans détruire sa confiance.
* **Exigence conceptuelle :** Chaque concept doit être défini précisément ; les raccourcis intellectuels ou les contradictions sont relevés à chaque tour de parole.
* **Autonomie de la pensée :** L'étudiant est remis au centre de son propre effort intellectuel ; c'est de sa friction avec le texte que naît le déclic conceptuel (l'anagnorisis).

### 2. Le Régulateur de Tension : L'Intégrale Dramatique $S(t)$
L'application intègre une modélisation mathématique et algorithmique inédite permettant d'adapter dynamiquement le comportement de l'IA en mesurant la charge cognitive cumulée de l'apprenant.

L'équation discrète de tension s'énonce ainsi :
$$S(t) = \left( \sum_{\tau=0}^{t} V(\tau) \cdot P(t|\tau) \right) \cdot C(t)$$

* **$V(\tau)$ (Le Registre des Actions) :** Le volume d'investigations, de formulations et d'efforts textuels fournis par l'étudiant à chaque étape $\tau$.
* **$P(t|\tau)$ (Le Poids de Rétroaction) :** Le moment de la Nachträglichkeit (après-coup). Il évalue la résonance conceptuelle et sémantique entre la question présente $t$ et les tentatives passées $\tau$, pondérée par une décroissance temporelle.
* **$C(t)$ (Le Tenseur de Friction) :** Mesure de la friction sémantique entre les représentations de l'étudiant $Ci(t)$ et le corpus académique de référence $Ce(t)$.
* **Bascule Dynamique de Posture :**
  * **$S(t) < 15.0$ (Tension faible) :** Stance maïeutique stricte. L'IA refuse de donner les réponses, renvoie l'étudiant à ses notes et pose uniquement des questions réflexives.
  * **$S(t) \ge 15.0$ (Tension critique atteinte) :** Stance d'accompagnement direct. L'effort est récompensé ; l'IA valide, éclaire, structure et aide activement à la synthèse conceptuelle.

### 3. Verrouillage Infrangible du Corpus & Zéro Hallucination
Pour garantir la rigueur scientifique de l'accompagnement :
* **Dépendance exclusive aux sources :** Socrate refuse formellement de répondre sur le fond de thématiques absentes de son corpus indexé.
* **Appel au document :** Si la référence est introuvable ou si le corpus est vide pour une requête donnée, Socrate interrompt la discussion spéculative et demande poliment à l'utilisateur de lui **transmettre ou d'uploader le fichier concerné** pour pouvoir engager l'analyse.

### 4. Souveraineté, Privauté et Hybridation
* **100% Local par défaut :** Socrate fait tourner ses modèles de langage (Llama 3.2, Qwen, Gemma) et ses embeddings de manière totalement privée et locale via Ollama et une base vectorielle Qdrant intégrée. Vos pensées privées et journaux intimes ne quittent jamais votre machine.
* **Hybridation Cloud-Safe :** La version en ligne (déployée sous Vercel) communique avec un Qdrant Cloud sécurisé et l'API OpenAI, tout en préservant le formatage original des fichiers via une persistance vectorielle `full_content` optimisée.

---

## 🛠️ Prérequis

- [Node.js](https://nodejs.org) v20+
- [Python](https://python.org) 3.11+
- [Ollama](https://ollama.com) avec les modèles de chat (`llama3.2`) et d'embeddings (`nomic-embed-text`) installés localement.

---

## 🚀 Lancer en Développement

### 1. Démarrer le Backend Python
```bash
cd server
# Sous Windows (crée le .venv, installe les dépendances et lance Uvicorn sur le port 8000)
call start.bat

# Sous Linux / macOS
bash start.sh
```

### 2. Démarrer le Frontend React (Vite)
```bash
# À la racine du projet
npm install
npm run dev
```
Ouvrir `http://localhost:5173`.

---

## 📦 Compilation Desktop (Electron)

Pour packager l'application en exécutable autonome de bureau :

```bash
npm run electron:start  # Pour tester en mode Electron local
npm run dist            # Pour compiler et générer l'installateur dans release/
```

Les installateurs et packages binaires finaux seront générés dans le dossier `release/`.

---

## 📜 Licence & Propriété

Socrate est un **logiciel libre** publié sous licence **GNU Affero General Public License v3.0 (AGPL-3.0-or-later)**. Le texte intégral de la licence est disponible dans le fichier [LICENSE](./LICENSE).

**Copyright © 2026 — Association àlaclé**
Association française régie par la loi du 1er juillet 1901.
RNA : **W131016315**
Contact : **contact@alacle.org**

Publié sous licence AGPL v3. Droits patrimoniaux détenus par l'association àlaclé. Modèle de l'Intégrale Dramatique S(t)S(t)
S(t) conçu par Étienne Lavallard, documenté publiquement depuis le 13 juin 2026.

### Ce que l'AGPL v3 implique

* ✅ Vous êtes libre d'**utiliser, étudier, modifier et redistribuer** Socrate, y compris à des fins commerciales.
* ⚖️ Toute redistribution ou version modifiée doit rester sous licence **AGPL v3** et **conserver les mentions de copyright** ci-dessus.
* 🌐 **Clause réseau (le cœur de l'AGPL) :** si vous mettez Socrate — ou une version modifiée — à disposition d'utilisateurs via un réseau (par exemple un service web ou une instance hébergée), vous êtes tenu de **rendre disponible le code source correspondant** à ces utilisateurs.
* 🛡️ Le logiciel est fourni **sans aucune garantie**, dans la mesure permise par la loi.

> Pour toute demande relative à une utilisation sous d'autres conditions (licence commerciale, partenariat, etc.), contactez l'association à l'adresse ci-dessus.
