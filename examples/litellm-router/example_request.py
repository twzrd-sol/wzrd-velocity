#!/usr/bin/env python3
"""End-to-end example of WZRD-pre-routing + LiteLLM fallback behavior."""

from __future__ import annotations

import argparse
import json

from wzrd_router import completion


def _parse_args():
    parser = argparse.ArgumentParser(description="LiteLLM + WZRD pre-router example")
    parser.add_argument(
        "--task",
        default="chat",
        help='Allowed task label (e.g. "chat", "coding").',
    )
    parser.add_argument(
        "--messages",
        nargs="*",
        default=["Hello from WZRD pre-router."],
        help="Prompt text to send (single line); repeat for multi-turn context if needed.",
    )
    parser.add_argument("--config", default="config.yaml", help="Path to your local WZRD router config.")
    parser.add_argument(
        "--candidate",
        action="append",
        dest="candidates",
        help="Explicit alias candidate (repeatable). If omitted, task config is used.",
    )
    parser.add_argument("--wzrd-url", default="https://api.twzrd.xyz/v1/signals/momentum")
    return parser.parse_args()


def main():
    args = _parse_args()
    messages = [{"role": "user", "content": " ".join(args.messages)}]
    result = completion(
        task=args.task,
        candidates=args.candidates,
        config_path=args.config,
        messages=messages,
        wzrd_url=args.wzrd_url,
        temperature=0.2,
    )

    # Keep response handling generic to match both Chat and plain text providers.
    if hasattr(result, "choices") and result.choices:
        first = result.choices[0]
        if hasattr(first, "message") and getattr(first.message, "content", None) is not None:
            print(first.message.content)
            return
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
