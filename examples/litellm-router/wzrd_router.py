#!/usr/bin/env python3
"""WZRD pre-router for LiteLLM aliases.

This module keeps dynamic routing logic in Python while leaving
LiteLLM alias/config semantics to LiteLLM (SDK or proxy).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

try:
    import requests
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit(f"Missing dependency: {exc.name}. Install requirements and retry.")


WZRD_MOMENTUM_URL = "https://api.twzrd.xyz/v1/signals/momentum"
DEFAULT_TIMEOUT_SECONDS = 5

# Keep scoring stable around WZRD trend semantics.
# cooling = delta < -30% (worse), decelerating = delta -5% to -30% (mild slowdown)
TREND_SCORE = {
    "surging": 3.0,
    "accelerating": 2.0,
    "stable": 0.0,
    "insufficient_history": 0.0,  # Treat like stable — no signal, no action
    "decelerating": -1.0,
    "cooling": -2.0,
}


@dataclass(frozen=True)
class MomentumSignal:
    model: str
    trend: str
    momentum_score: float
    velocity_delta_pct: float
    history_depth: int
    history_confidence: str
    routing_implication: str

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "MomentumSignal":
        trend = str(payload.get("velocity_trend", payload.get("trend", "stable"))).lower()
        return cls(
            model=str(payload.get("model", "")),
            trend=trend,
            momentum_score=_clamp_float(payload.get("momentum_score", 0.0), 0.0, 1.0),
            velocity_delta_pct=_clamp_float(payload.get("velocity_delta_pct", 0.0), -1_000_000.0, 1_000_000.0),
            history_depth=int(payload.get("history_depth", 0) or 0),
            history_confidence=str(payload.get("history_confidence", "insufficient")).lower(),
            routing_implication=str(payload.get("routing_implication", "maintain")),
        )

    def score(self) -> float:
        trend_component = TREND_SCORE.get(self.trend, 0.0)
        momentum_component = self.momentum_score * 0.30
        delta_component = _clamp_float(self.velocity_delta_pct / 100.0, -2.0, 2.0) * 0.25
        return trend_component + momentum_component + delta_component


def choose_model(
    task: str,
    candidates: Optional[Sequence[str]] = None,
    *,
    wzrd_url: str = WZRD_MOMENTUM_URL,
    timeout: Optional[int] = None,
    config_path: Optional[str] = None,
) -> str:
    """Pick one LiteLLM alias from candidates using WZRD momentum.

    candidates can be passed directly, or omitted to use aliases configured
    for the task in the config file.
    """
    config = _load_config(_resolve_config_path(config_path))
    candidate_aliases = _resolve_candidates(task, candidates, config)
    if not candidate_aliases:
        raise ValueError("No candidate aliases were resolved for task.")

    request_timeout = _resolve_timeout(config, timeout)
    request_url = _resolve_wzrd_url(config, wzrd_url)
    momentum_payload = _fetch_momentum(request_url, request_timeout)
    alias_to_models = config.get("aliases", {})
    ranked = _rank_aliases(candidate_aliases, momentum_payload, alias_to_models)
    if not ranked:
        return candidate_aliases[0]
    return ranked[0][0]


def choose_model_with_reasons(
    task: str,
    candidates: Optional[Sequence[str]] = None,
    *,
    wzrd_url: str = WZRD_MOMENTUM_URL,
    timeout: Optional[int] = None,
    config_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Pick a candidate and return ranking metadata for logging/debugging."""
    config = _load_config(_resolve_config_path(config_path))
    candidate_aliases = _resolve_candidates(task, candidates, config)
    if not candidate_aliases:
        raise ValueError("No candidate aliases were resolved for task.")

    request_timeout = _resolve_timeout(config, timeout)
    request_url = _resolve_wzrd_url(config, wzrd_url)
    momentum_payload = _fetch_momentum(request_url, request_timeout)
    alias_to_models = config.get("aliases", {})
    ranked = _rank_aliases(candidate_aliases, momentum_payload, alias_to_models)
    ranked_view = [
        {
            "alias": alias,
            "score": score,
            "trend": signal.trend if signal else None,
            "history_confidence": signal.history_confidence if signal else None,
            "history_depth": signal.history_depth if signal else None,
            "routing_implication": signal.routing_implication if signal else None,
            "matched_signal": signal.model if signal else None,
            "source_delta_pct": signal.velocity_delta_pct if signal else None,
        }
        for alias, score, signal in ranked
    ]
    return {
        "choice": ranked[0][0] if ranked else candidate_aliases[0],
        "ranking": ranked_view,
        "task": task,
        "wzrd_url": request_url,
        "candidates": list(candidate_aliases),
        "fallback_aliases": [alias for alias, *_ in ranked[1:]],
    }


def completion(
    *,
    task: str,
    messages: Sequence[Dict[str, str]],
    candidates: Optional[Sequence[str]] = None,
    wzrd_url: str = WZRD_MOMENTUM_URL,
    timeout: Optional[int] = None,
    config_path: Optional[str] = None,
    **litellm_kwargs: Any,
):
    """Route one LiteLLM completion request through WZRD pre-router."""
    result = choose_model_with_reasons(
        task=task,
        candidates=candidates,
        wzrd_url=wzrd_url,
        timeout=timeout,
        config_path=_resolve_config_path(config_path),
    )
    model_choice = result["choice"]
    fallback_models = result["fallback_aliases"]

    try:
        import litellm
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "LiteLLM is not installed. Install requirements and retry."
        ) from exc

    return litellm.completion(
        model=model_choice,
        messages=list(messages),
        fallbacks=fallback_models,
        **litellm_kwargs,
    )


def _resolve_candidates(task: str, candidates: Optional[Sequence[str]], config: Dict[str, Any]) -> List[str]:
    candidate_aliases = list(candidates or [])
    if not candidate_aliases:
        task_cfg = config.get("tasks", {}).get(task)
        if isinstance(task_cfg, dict):
            task_aliases = task_cfg.get("allowed_aliases")
            if isinstance(task_aliases, list):
                candidate_aliases = task_aliases
    if not candidate_aliases:
        candidate_aliases = list(config.get("aliases", {}).keys())
    return _dedupe_preserve_order(candidate_aliases)


def _rank_aliases(
    candidates: Sequence[str],
    momentum_payload: Dict[str, Any],
    alias_to_wzrd_models: Mapping[str, Any],
) -> List[Tuple[str, float, Optional[MomentumSignal]]]:
    signals = _parse_signals(momentum_payload)
    scored: List[Tuple[str, float, Optional[MomentumSignal]]] = []
    seen_order = {alias: idx for idx, alias in enumerate(candidates)}
    for alias in candidates:
        aliases = alias_to_wzrd_models.get(alias, alias)
        alias_signals = _collect_matching_signals(aliases, signals)

        best_signal = None
        best_score = None
        for signal in alias_signals:
            candidate_score = signal.score()
            if best_score is None or candidate_score > best_score:
                best_score = candidate_score
                best_signal = signal

        if best_score is None:
            # No matching WZRD signal: keep deterministic order with small
            # preference for earlier aliases in the configured allowed set.
            best_score = -0.001 * seen_order.get(alias, 0)

        scored.append((alias, best_score, best_signal))

    scored.sort(
        key=lambda item: (item[1], -seen_order.get(item[0], 10_000)),
        reverse=True,
    )
    return scored


def _collect_matching_signals(
    alias_terms: Iterable[str] | str,
    signals: List[MomentumSignal],
) -> List[MomentumSignal]:
    terms = [alias_terms] if isinstance(alias_terms, str) else list(alias_terms)
    normalized_terms = {_normalize_model_name(term) for term in terms if term}
    matches: List[MomentumSignal] = []
    for signal in signals:
        if _normalize_model_name(signal.model) in normalized_terms:
            matches.append(signal)
        else:
            for term in normalized_terms:
                if term and term in _normalize_model_name(signal.model):
                    matches.append(signal)
                    break
    return matches


def _parse_signals(payload: Dict[str, Any]) -> List[MomentumSignal]:
    models = []
    if isinstance(payload, dict):
        models = payload.get("models", [])
    elif isinstance(payload, list):
        models = payload
    if not isinstance(models, list):
        return []
    return [MomentumSignal.from_payload(item) for item in models if isinstance(item, dict)]


def _fetch_momentum(url: str, timeout: int) -> Dict[str, Any]:
    try:
        response = requests.get(url, timeout=max(1, timeout))
        response.raise_for_status()
    except requests.RequestException as exc:
        # Degrade gracefully — WZRD being down should never crash the inference pipeline.
        # _rank_aliases handles empty payloads by falling back to config order.
        print(f"wzrd-router: momentum feed unavailable ({exc}), using config order", file=sys.stderr)
        return {}
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        print(f"wzrd-router: invalid momentum response ({exc}), using config order", file=sys.stderr)
        return {}
    if not isinstance(data, (dict, list)):
        print("wzrd-router: unexpected payload format, using config order", file=sys.stderr)
        return {}
    return data


def _load_config(config_path: Optional[str]) -> Dict[str, Any]:
    if not config_path:
        return {}
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}")
    with open(config_path, "r", encoding="utf-8") as file:
        parsed = yaml.safe_load(file) or {}
    if not isinstance(parsed, dict):
        raise ValueError("Config file is malformed; expected YAML dictionary.")
    return parsed


def _resolve_config_path(config_path: Optional[str]) -> Optional[str]:
    if config_path is not None:
        return config_path

    script_dir = Path(__file__).resolve().parent
    for candidate in ("config.yaml", "config.example.yaml"):
        candidate_path = script_dir / candidate
        if candidate_path.exists():
            return str(candidate_path)
    return None


def _dedupe_preserve_order(values: Sequence[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for value in values:
        alias = str(value).strip()
        if not alias or alias in seen:
            continue
        seen.add(alias)
        out.append(alias)
    return out


def _normalize_model_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value).strip().lower())


def _clamp_float(value: Any, min_value: float, max_value: float) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(min_value, min(max_value, num))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Choose one LiteLLM alias using WZRD momentum.",
    )
    parser.add_argument("--task", default="chat", help='Task name for candidate filtering, e.g. "chat"')
    parser.add_argument(
        "--candidates",
        nargs="+",
        help="Optional override candidate aliases for this request (space-separated).",
    )
    parser.add_argument("--config", default=None, help="Path to a WZRD router config file.")
    parser.add_argument("--wzrd-url", default=WZRD_MOMENTUM_URL, help="Momentum endpoint URL.")
    parser.add_argument("--timeout", type=int, default=None, help="Override WZRD momentum request timeout (seconds).")
    parser.add_argument("--print-json", action="store_true", help="Print full routing metadata JSON.")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    result = choose_model_with_reasons(
        task=args.task,
        candidates=args.candidates,
        config_path=args.config,
        wzrd_url=args.wzrd_url,
        timeout=args.timeout,
    )
    if args.print_json:
        print(json.dumps(result, indent=2))
        return
    print(f"task={args.task}")
    print(f"choice={result['choice']}")
    print(f"fallbacks={', '.join(result['fallback_aliases']) if result['fallback_aliases'] else 'none'}")


def _resolve_timeout(config: Dict[str, Any], timeout: Optional[int]) -> int:
    if timeout is not None:
        return max(1, int(timeout))

    wzrd_cfg = config.get("wzrd", {})
    if isinstance(wzrd_cfg, dict):
        configured = wzrd_cfg.get("request_timeout_seconds")
        if isinstance(configured, (int, float)):
            return max(1, int(configured))

    return DEFAULT_TIMEOUT_SECONDS


def _resolve_wzrd_url(config: Dict[str, Any], wzrd_url: str) -> str:
    if wzrd_url != WZRD_MOMENTUM_URL:
        return wzrd_url

    wzrd_cfg = config.get("wzrd", {})
    if isinstance(wzrd_cfg, dict):
        configured = str(wzrd_cfg.get("momentum_url", "")).strip()
        if configured:
            return configured
    return wzrd_url


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"wzrd-router error: {exc}", file=sys.stderr)
        sys.exit(1)
