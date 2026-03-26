#!/usr/bin/env python3
"""
WZRD Momentum Router for Portkey AI Gateway.

Fetches real-time model velocity from WZRD and sets Portkey metadata
for conditional routing. Portkey handles retries, fallbacks, and caching.

Usage:
    from wzrd_portkey import wzrd_completion

    response = wzrd_completion(
        messages=[{"role": "user", "content": "Hello"}],
        candidates=["qwen-9b", "qwen-35b", "llama-70b"],
    )

Or use the metadata directly:

    from wzrd_portkey import get_wzrd_metadata
    metadata = get_wzrd_metadata(candidates=["qwen-9b", "qwen-35b"])
    # Pass metadata to Portkey gateway for conditional routing
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

try:
    import requests
except ImportError:
    raise SystemExit("Missing dependency: requests. pip install requests")

WZRD_MOMENTUM_URL = "https://api.twzrd.xyz/v1/signals/momentum"
_CACHE_TTL = 300  # 5 minutes
_cache: Dict[str, tuple] = {}

# Alias → WZRD model names (same mapping as LiteLLM recipe)
DEFAULT_ALIASES: Dict[str, List[str]] = {
    "qwen-9b": ["Qwen/Qwen3.5-9B"],
    "qwen-35b": ["Qwen/Qwen3.5-35B-A3B"],
    "qwen-4b": ["Qwen/Qwen3.5-4B"],
    "llama-70b": ["meta-llama/Llama-3.3-70B-Instruct"],
    "mistral-large": ["mistralai/mistral-inference"],
}

TREND_PRIORITY = {
    "surging": 5,
    "accelerating": 4,
    "stable": 3,
    "insufficient_history": 3,  # Treat like stable — no signal, no action
    "decelerating": 2,
    "cooling": 1,
}

REQUIRED_MODEL_FIELDS = {
    "model",
    "velocity_trend",
    "momentum_score",
    "velocity_delta_pct",
    "history_confidence",
}


@dataclass
class Signal:
    model: str
    trend: str
    delta_pct: float
    velocity: float
    routing: str
    history_depth: int
    history_confidence: str


def _fetch(url: str = WZRD_MOMENTUM_URL, timeout: int = 5) -> List[Signal]:
    """Fetch momentum signals. Cached 5 min. Never raises."""
    now = time.monotonic()
    cached = _cache.get(url)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1]

    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"wzrd-portkey: momentum unavailable ({e}), using defaults", file=sys.stderr)
        return []

    if not _payload_contract_ok(data):
        print("wzrd-portkey: payload contract mismatch, using defaults", file=sys.stderr)
        return []

    signals = []
    for m in data.get("models", []):
        signals.append(Signal(
            model=m.get("model", ""),
            trend=m.get("velocity_trend", "stable"),
            delta_pct=m.get("velocity_delta_pct", 0.0),
            velocity=m.get("velocity_ema", 0.0),
            routing=m.get("routing_implication", "maintain"),
            history_depth=int(m.get("history_depth", 0) or 0),
            history_confidence=str(m.get("history_confidence", "insufficient")).lower(),
        ))

    _cache[url] = (now, signals)
    return signals


def _payload_contract_ok(data: Dict[str, Any]) -> bool:
    """Validate minimum API contract to guard against schema drift."""
    if not isinstance(data.get("signal_version"), int):
        return False
    models = data.get("models")
    if not isinstance(models, list):
        return False
    for model in models:
        if not isinstance(model, dict):
            return False
        if not REQUIRED_MODEL_FIELDS.issubset(model.keys()):
            return False
    return True


def _match(alias: str, signals: List[Signal], aliases: Dict[str, List[str]]) -> Optional[Signal]:
    """Find the WZRD signal matching a Portkey model alias."""
    names = aliases.get(alias, [alias])
    by_name = {s.model: s for s in signals}
    for n in names:
        if n in by_name:
            return by_name[n]
    # Fuzzy fallback
    for s in signals:
        for n in names:
            if n.lower() in s.model.lower():
                return s
    return None


def get_wzrd_metadata(
    candidates: Sequence[str],
    aliases: Optional[Dict[str, List[str]]] = None,
    wzrd_url: str = WZRD_MOMENTUM_URL,
) -> Dict[str, Any]:
    """
    Build Portkey-compatible metadata dict with WZRD momentum signals.

    Returns a dict suitable for passing as `metadata` to Portkey gateway:
    {
        "wzrd_preferred": "qwen-9b",
        "wzrd_trend": "accelerating",
        "wzrd_delta_pct": 11.9,
        "wzrd_routing": "pre_warm",
        "wzrd_ranking": [
            {"alias": "qwen-9b", "trend": "accelerating", "priority": 4},
            {"alias": "qwen-35b", "trend": "stable", "priority": 3},
        ]
    }
    """
    amap = aliases or DEFAULT_ALIASES
    signals = _fetch(wzrd_url)

    ranking = []
    for alias in candidates:
        sig = _match(alias, signals, amap)
        trend = sig.trend if sig else "stable"
        ranking.append({
            "alias": alias,
            "trend": trend,
            "delta_pct": sig.delta_pct if sig else 0.0,
            "velocity": sig.velocity if sig else 0.0,
            "routing": sig.routing if sig else "maintain",
            "history_depth": sig.history_depth if sig else 0,
            "history_confidence": sig.history_confidence if sig else "insufficient",
            "priority": TREND_PRIORITY.get(trend, 3),
        })

    ranking.sort(key=lambda x: x["priority"], reverse=True)

    best = ranking[0] if ranking else {}
    return {
        "wzrd_preferred": best.get("alias", candidates[0] if candidates else ""),
        "wzrd_trend": best.get("trend", "stable"),
        "wzrd_delta_pct": best.get("delta_pct", 0.0),
        "wzrd_routing": best.get("routing", "maintain"),
        "wzrd_history_depth": best.get("history_depth", 0),
        "wzrd_history_confidence": best.get("history_confidence", "insufficient"),
        "wzrd_ranking": ranking,
    }


def wzrd_completion(
    messages: Sequence[Dict[str, str]],
    candidates: Sequence[str],
    aliases: Optional[Dict[str, List[str]]] = None,
    portkey_api_key: Optional[str] = None,
    virtual_key: Optional[str] = None,
    **kwargs: Any,
) -> Any:
    """
    Route a completion through Portkey with WZRD momentum metadata.

    Requires: pip install portkey-ai
    """
    try:
        from portkey_ai import Portkey
    except ImportError:
        raise RuntimeError("pip install portkey-ai")

    import os
    api_key = portkey_api_key or os.environ.get("PORTKEY_API_KEY", "")

    meta = get_wzrd_metadata(candidates, aliases)
    model = meta["wzrd_preferred"]

    client = Portkey(api_key=api_key, virtual_key=virtual_key)
    return client.chat.completions.create(
        model=model,
        messages=list(messages),
        metadata=meta,
        **kwargs,
    )


if __name__ == "__main__":
    import json
    candidates = sys.argv[1:] or ["qwen-9b", "qwen-35b", "llama-70b"]
    meta = get_wzrd_metadata(candidates)
    print(json.dumps(meta, indent=2))
