#!/usr/bin/env python3
"""Bridge helper: score the real LiteLLM WZRD plugin for a candidate set."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


PLUGIN_DIR = Path(__file__).resolve().parents[2] / "litellm-wzrd-plugin"
sys.path.insert(0, str(PLUGIN_DIR))

import wzrd_momentum_strategy as wms


class FakeRouter:
    def __init__(self, model_list: list[dict[str, Any]]):
        self.model_list = model_list
        self._custom_strategy = None

    def set_custom_routing_strategy(self, strategy: Any) -> None:
        self._custom_strategy = strategy


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score deployments via the WZRD LiteLLM plugin.")
    parser.add_argument("--wzrd-url", default="https://api.twzrd.xyz/v1/signals/momentum/premium")
    parser.add_argument("--payload-json", default=None)
    parser.add_argument("--deployments-json", required=True)
    parser.add_argument("--alias-map-json", required=True)
    parser.add_argument("--model", default="all-models")
    parser.add_argument("--timeout", type=float, default=5.0)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    deployments = json.loads(args.deployments_json)
    alias_map = json.loads(args.alias_map_json)
    payload = json.loads(args.payload_json) if args.payload_json else None

    if not isinstance(deployments, list):
        raise ValueError("deployments-json must decode to a list")
    if not isinstance(alias_map, dict):
        raise ValueError("alias-map-json must decode to an object")
    if payload is not None and not isinstance(payload, dict):
        raise ValueError("payload-json must decode to an object")

    router = FakeRouter(deployments)
    wms.clear_cache()
    strategy = wms.register(router, wzrd_url=args.wzrd_url, alias_map=alias_map, cache_ttl=0)

    original_fetch = wms._fetch_momentum
    try:
        if payload is not None:
            wms._fetch_momentum = lambda url, timeout=args.timeout: payload
            data = payload
        else:
            data = wms._fetch_momentum(strategy.wzrd_url, timeout=args.timeout)

        scored: list[dict[str, Any]] = []

        for index, deployment in enumerate(deployments):
            score, signal = wms._score_deployment(deployment, data, alias_map, index)
            scored.append(
                {
                    "index": index,
                    "model_name": deployment.get("model_name"),
                    "litellm_model": (deployment.get("litellm_params") or {}).get("model"),
                    "score": score,
                    "matched_signal": signal.get("model") if signal else None,
                    "trend": (signal or {}).get("trend", (signal or {}).get("velocity_trend")) if signal else None,
                    "confidence": (signal or {}).get("confidence", (signal or {}).get("history_confidence")) if signal else None,
                }
            )

        ranked = sorted(scored, key=lambda item: (item["score"], -item["index"]), reverse=True)
        selected = strategy.get_available_deployment(args.model)

        print(
            json.dumps(
                {
                    "selected_model_name": selected.get("model_name") if selected else None,
                    "selected_litellm_model": ((selected or {}).get("litellm_params") or {}).get("model") if selected else None,
                    "tracked_models": len(data.get("models", [])) if isinstance(data, dict) else 0,
                    "ranking": ranked,
                }
            )
        )
    finally:
        wms._fetch_momentum = original_fetch


if __name__ == "__main__":
    main()
