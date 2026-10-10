"""Logique partagée entre le serveur local (main.py) et le relais web (api/index.py) :
client Albert API et construction du prompt maïeutique. Aucune dépendance à Qdrant
ni à Ollama, pour pouvoir tourner dans une fonction serverless."""

import json
import os
from collections.abc import AsyncIterator

import httpx

from metrics.dramatic_integral import calculate_dramatic_tension

# Albert API (DINUM / Etalab), compatible OpenAI.
ALBERT_API_KEY = os.getenv("ALBERT_API_KEY", "")
ALBERT_BASE_URL = os.getenv("ALBERT_BASE_URL", "https://albert.api.etalab.gouv.fr/v1").rstrip("/")
ALBERT_MODEL = os.getenv("ALBERT_MODEL", "mistral-small-3-2-24b-instruct-2506")
ALBERT_EMBED_MODEL = os.getenv("ALBERT_EMBED_MODEL", "bge-m3")
ALBERT_CHAT_TYPES = ("text-generation", "image-text-to-text")


def _albert_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {ALBERT_API_KEY}"}


def albert_embed(texts: list[str], model: str = ALBERT_EMBED_MODEL) -> list[list[float]]:
    response = httpx.post(
        f"{ALBERT_BASE_URL}/embeddings",
        headers=_albert_headers(),
        json={"model": model, "input": texts},
        timeout=120,
    )
    response.raise_for_status()
    data = sorted(response.json()["data"], key=lambda item: item["index"])
    return [item["embedding"] for item in data]


def albert_chat_models() -> list[dict]:
    response = httpx.get(f"{ALBERT_BASE_URL}/models", headers=_albert_headers(), timeout=20)
    response.raise_for_status()
    return [
        {"name": model.get("id", ""), "size": 0, "modified_at": ""}
        for model in response.json().get("data", [])
        if model.get("type") in ALBERT_CHAT_TYPES and "ocr" not in model.get("id", "")
    ]


async def albert_stream(model: str, messages: list[dict]) -> AsyncIterator[str]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20)) as client:
        async with client.stream(
            "POST",
            f"{ALBERT_BASE_URL}/chat/completions",
            headers=_albert_headers(),
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            if response.status_code >= 400:
                body = (await response.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"HTTP {response.status_code}: {body[:300]}")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                choices = json.loads(payload).get("choices") or []
                content = (choices[0].get("delta") or {}).get("content") if choices else None
                if content:
                    yield content


def build_chat_messages(
    message: str,
    history: list[dict],
    context: str,
    style_context: str = "",
    use_corpus: bool = True,
) -> list[dict]:
    """Prompt système maïeutique (piloté par l'Intégrale Dramatique S(t)) + historique."""
    tension_metrics = calculate_dramatic_tension(history, message, context)
    is_maieutic = tension_metrics["maieutic_posture"]
    tension_score = tension_metrics["tension_score"]

    system_prompt = (
        "Tu es un directeur de recherche universitaire spécialisé en théorie de l'art, "
        "de l'écriture narrative et de la représentation. "
        "Tu connais intimement les travaux de cet étudiant — tu as lu ses textes, "
        "ses scénarios, son journal. Tu travailles depuis son corpus et depuis sa propre écriture.\n\n"
        f"[PEDAGOGICAL METRICS: Dramatic Tension S(t)={tension_score}, Posture={'Maïeutique Pure' if is_maieutic else 'Accompagnement Direct'}]\n\n"
        "Ton approche :\n"
        "— Tu poses des questions qui déstabilisent les certitudes sans les détruire.\n"
        "— Tu exiges que chaque affirmation soit étayée, chaque concept défini avec précision.\n"
        "— Tu identifies les glissements conceptuels, les contradictions, "
        "les raccourcis intellectuels non justifiés.\n"
        "— Tu proposes des pistes depuis le corpus quand c'est pertinent, "
        "avec la référence exacte entre crochets.\n"
        "— Tu reconnais la voix de cet étudiant et tu t'y accordes — "
        "tu adoptes son registre, son rythme, sa façon d'articuler les idées.\n"
        "— Tu ne flattes pas. Tu stimules. Tu exiges.\n\n"
    )

    if is_maieutic:
        system_prompt += (
            "POSTURE MAÏEUTIQUE STRICTE (Tension cumulée S(t) faible) :\n"
            "— Tu REFUSES catégoriquement de donner des réponses directes, de faire des résumés ou de valider platement les concepts.\n"
            "— Tu réponds uniquement par des relances maïeutiques, en pointant les contradictions ou en renvoyant l'étudiant à ses propres notes passées.\n"
            "— Provoque le déclic par l'effort cognitif et la problématisation.\n\n"
        )
    else:
        system_prompt += (
            "POSTURE D'ACCOMPAGNEMENT DIRECT (Tension critique S(t) atteinte) :\n"
            "— L'effort cognitif de l'étudiant est suffisant. Tu peux maintenant être plus explicite, direct et l'aider à conceptualiser.\n"
            "— Valide constructivement ses idées, apporte des pistes directes et accompagne sa synthèse.\n\n"
        )

    system_prompt += "Réponds en français. Sois précis, exigeant, et intellectuellement stimulant."

    if style_context:
        system_prompt += (
            "\n\nExtraits de l'écriture de cet étudiant — "
            "calibre ta voix sur la sienne :\n\n"
            + style_context
        )

    if use_corpus:
        if context.strip():
            system_prompt += (
                "\n\nCorpus de recherche. Utilise uniquement ces extraits pour répondre. "
                "Cite obligatoirement la source exacte entre crochets avec le nom du fichier. "
                "Si les extraits fournis ne contiennent pas d'information ou de référence précise pour répondre à la question de l'étudiant, "
                "tu dois IMPÉRATIVEMENT refuser de répondre sur le fond et lui demander poliment de te transmettre le document concerné "
                "ou de l'ajouter à son corpus afin que vous puissiez dialoguer ensemble sur cette base.\n\n"
                + context
            )
        else:
            system_prompt += (
                "\n\nIMPORTANT (Corpus manquant/insuffisant) : Tu ne disposes d'AUCUN extrait de corpus pertinent pour cette requête. "
                "Tu as l'interdiction formelle de répondre sur le fond de la question ou d'inventer des faits. "
                "Tu dois obligatoirement et poliment déclarer que tu n'as pas trouvé cette référence dans tes documents, "
                "et demander à l'utilisateur de te transmettre le fichier concerné ou de l'ajouter à son corpus afin de pouvoir engager le dialogue."
            )
    else:
        system_prompt += (
            "\n\nIMPORTANT : Le corpus n'est pas actif pour cette requête. "
            "Tu dois impérativement rappeler à l'utilisateur qu'il doit activer son corpus ou te transmettre un document "
            "pour pouvoir engager un dialogue d'analyse de recherche."
        )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = "assistant" if msg["role"] == "model" else msg["role"]
        messages.append({"role": role, "content": msg["content"]})
    messages.append({"role": "user", "content": message})
    return messages
