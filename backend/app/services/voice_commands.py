"""Deterministic, allowlisted voice-command matching (mirrors the frontend
allowlist in frontend/src/lib/ar/voice.ts). No LLM interpretation: only
finalized, exact phrases after normalization produce an action."""

import re
import unicodedata

_PHRASES: dict[str, tuple[str, str]] = {}


def _add(action: str, language: str, phrases: list[str]) -> None:
    for phrase in phrases:
        _PHRASES[phrase] = (action, language)


_add(
    "next",
    "en",
    ["next step", "next steps", "go to next step", "go to the next step", "go forward"],
)
_add(
    "previous",
    "en",
    [
        "previous step",
        "previous steps",
        "go to previous step",
        "go to the previous step",
        "prev step",
        "go back",
        "back one step",
    ],
)
_add("verify", "en", ["verify step", "verify this step", "verify the step", "inspect step"])
_add(
    "verify-again",
    "en",
    ["verify again", "verify it again", "verify step again", "inspect again"],
)
_add(
    "show-reference",
    "en",
    [
        "show reference",
        "show reference photo",
        "show reference photograph",
        "display reference",
        "show the reference",
    ],
)
_add(
    "hide-reference",
    "en",
    ["hide reference", "hide reference photo", "hide reference photograph", "hide the reference"],
)
_add(
    "show-instructions",
    "en",
    ["show instructions", "show instruction", "expand instructions", "show the instructions"],
)
_add(
    "read-instructions",
    "en",
    [
        "read instructions",
        "read instruction",
        "read instructions aloud",
        "read the instructions",
        "read the instruction aloud",
    ],
)
_add("re-anchor", "en", ["reanchor", "re anchor", "reset alignment", "reset tabletop alignment"])
_add(
    "recenter",
    "en",
    ["recenter", "recenter panel", "re centre", "re centre panel", "center panel", "centre panel"],
)
_add("help", "en", ["help", "show commands", "show help", "list commands"])
_add(
    "stop-listening",
    "en",
    ["stop listening", "stop voice", "disable voice", "turn off microphone", "stop microphone"],
)
_add("exit", "en", ["exit ar", "leave ar", "close ar", "quit ar", "exit"])
# German aliases (normalized forms after umlaut folding).
_add("next", "de", ["naechster schritt", "nachster schritt"])
_add("previous", "de", ["vorheriger schritt"])
_add("verify", "de", ["schritt pruefen", "schritt prufen"])
_add("verify-again", "de", ["erneut pruefen", "nochmal pruefen", "schritt erneut pruefen"])
_add("show-reference", "de", ["referenz anzeigen", "referenz zeigen"])
_add("read-instructions", "de", ["anleitung vorlesen", "anleitung lesen"])
_add("exit", "de", ["ar beenden", "beenden"])

_NEGATIONS = ("do not", "dont", "never")
_ACTION_KEYWORDS = {
    "next": "next",
    "previous": "previous",
    "prev": "previous",
    "verify": "verify",
    "recenter": "recenter",
    "reanchor": "re-anchor",
}


def normalize_transcript(raw: str) -> str:
    text = unicodedata.normalize("NFC", raw or "").lower()
    text = re.sub(r"[.,!?;:()\"“”„'’`]", " ", text)
    text = re.sub(r"[-–—]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^(hey |ok )?assembly ?pilot[ ,:]? ", "", text).strip()
    if text in ("assemblypilot", "assembly pilot"):
        text = ""
    text = (
        text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    )
    return re.sub(r"\s+", " ", text).strip()


def match_command(raw: str) -> dict | None:
    """Return {action, phrase, language} or None for unknown/ambiguous speech."""
    normalized = normalize_transcript(raw)
    if not normalized:
        return None
    if any(n in normalized for n in _NEGATIONS) or normalized.startswith(("not ", "no ")):
        return None
    if " and " in normalized:
        return None
    mentioned = {_ACTION_KEYWORDS[t] for t in normalized.split(" ") if t in _ACTION_KEYWORDS}
    if "exit" in normalized and "step" in normalized:
        return None
    if len(mentioned) > 1:
        return None
    hit = _PHRASES.get(normalized)
    if hit is None:
        return None
    return {"action": hit[0], "phrase": normalized, "language": hit[1]}
