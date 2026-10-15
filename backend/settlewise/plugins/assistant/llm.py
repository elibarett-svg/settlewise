"""Claude-backed answer generation for the AI Settlement Assistant (3.1 - 3.5)."""

import json
import logging
import os
from typing import Any

import anthropic

log = logging.getLogger("settlewise.assistant")

SYSTEM_PROMPT = """You are the SettleWise settlement assistant. You help newcomers to Canada understand \
the practical steps of life events such as moving home, travelling, starting a job, family changes and \
preparing documents.

How to answer:
- Base every factual statement on the numbered official sources in the user's message, and list the ids \
of the sources you relied on. If the sources do not cover the question, say so plainly, keep the answer \
general, and set confidence to "low".
- Use plain language and short paragraphs. Write in the language the person prefers if it is given.
- Use the person's context (province, status, active plans) to make the answer relevant, but do not \
repeat personal details back unnecessarily.
- SettleWise does not give legal or immigration advice, does not predict whether an application will be \
approved, and does not decide eligibility. When a question depends on the details of the person's own \
case, give only general information, set needs_professional to true and explain briefly why a licensed \
immigration consultant or lawyer should look at it.
- Use uncertainty_note to say what is uncertain or what missing detail would change the answer. Leave it \
empty when nothing is uncertain.
- Suggest at most three concrete next actions the person could add to their plan, each phrased as a task \
title starting with a verb. Suggest none if nothing practical follows."""

ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "source_ids": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "uncertainty_note": {"type": "string"},
        "needs_professional": {"type": "boolean"},
        "professional_reason": {"type": "string"},
        "suggested_actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["title", "category"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "answer",
        "source_ids",
        "confidence",
        "uncertainty_note",
        "needs_professional",
        "professional_reason",
        "suggested_actions",
    ],
    "additionalProperties": False,
}


def llm_configured() -> bool:
    return any(os.environ.get(v) for v in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"))


class ClaudeAnswerer:
    def __init__(self, model: str):
        self.model = model
        self.client = anthropic.Anthropic()

    def answer(
        self, question: str, sources: list[dict[str, Any]], context: dict[str, Any], history: list[dict[str, str]]
    ) -> dict[str, Any] | None:
        """Return the structured answer, or None so the caller falls back to the offline answer."""
        source_text = (
            "\n\n".join(f"[{s['id']}] {s['title']} ({s['publisher']})\n{s['summary']}" for s in sources)
            or "(no matching sources)"
        )
        recent = "\n".join(f"Q: {h['question']}\nA: {h['answer']}" for h in history) or "(none)"
        prompt = (
            f"<sources>\n{source_text}\n</sources>\n\n"
            f"<person_context>\n{json.dumps(context, default=str)}\n</person_context>\n\n"
            f"<recent_questions>\n{recent}\n</recent_questions>\n\n"
            f"<question>\n{question}\n</question>"
        )
        try:
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=SYSTEM_PROMPT,
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": ANSWER_SCHEMA}},
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.RateLimitError:
            log.warning("Claude rate limited; using offline answer")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("Claude API error %s (request %s)", exc.status_code, exc.response.headers.get("request-id"))
            return None
        except anthropic.APIConnectionError:
            log.warning("Could not reach the Claude API; using offline answer")
            return None

        if response.stop_reason == "refusal":
            log.info("Claude declined the question (%s)", getattr(response.stop_details, "category", None))
            return None
        if response.stop_reason == "max_tokens":
            log.warning("Claude answer was cut off; using offline answer")
            return None
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            return None
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            log.warning("Claude returned invalid JSON; using offline answer")
            return None
        data["model"] = response.model
        return data
