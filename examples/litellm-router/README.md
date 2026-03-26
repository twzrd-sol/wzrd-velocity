# LiteLLM + WZRD Router

Route to rising models using WZRD momentum + LiteLLM fallbacks.

This integration keeps strategy in a tiny Python shim (`wzrd_router.py`) and keeps
LiteLLM configuration static in YAML. It is SDK-first and proxy-compatible:
route one request in Python, then pass the chosen alias to LiteLLM.

## Layout

```text
litellm-wzrd-router/
├── README.md
├── requirements.txt
├── wzrd_router.py
├── config.example.yaml
└── example_request.py
```

## Why this shape

- `config.example.yaml` owns **only** static LiteLLM aliases and candidate lists.
- `wzrd_router.py` owns dynamic strategy:
  - fetch `/v1/signals/momentum`
  - map WZRD models into your alias candidates
  - score candidates by trend and momentum
  - pick one alias
  - pass it to LiteLLM with the remaining candidates as fallbacks

That keeps maintenance clean and lets LiteLLM continue doing retries/fallbacks.

## Quick Start

1. install

```bash
cd integrations/litellm-wzrd-router
python -m pip install -r requirements.txt
cp config.example.yaml config.yaml
```

2. edit `config.yaml` with your 3–5 LiteLLM aliases/operators (already configured in your LiteLLM setup).  
   If `config.yaml` is missing, the example falls back to `config.example.yaml`.

3. run a request

```bash
python example_request.py \
  --task chat \
  --config config.yaml
```

4. every request gets WZRD-biased routing, then LiteLLM handles runtime retries/fallbacks

## API shape

Contract in practice:

```python
from wzrd_router import choose_model

choice = choose_model(
    task="chat",
    candidates=["qwen-9b", "qwen-35b", "llama-70b"],
    wzrd_url="https://api.twzrd.xyz/v1/signals/momentum",
)
```

And then:

```python
import litellm

response = litellm.completion(
    model=choice,
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Config reference (`config.example.yaml`)

- `wzrd.momentum_url`: signal source URL
- `wzrd.request_timeout_seconds`: GET timeout for `/v1/signals/momentum`
- `aliases`: static map of LiteLLM alias -> list of WZRD model names it can represent
- `tasks`: static allowed candidate sets per task

`tasks` can be reused across environments. No dynamic thresholds, weights, or
fallback rules are encoded in YAML.

## Routing heuristics in `wzrd_router.py`

For each allowed alias:

1. collect matching WZRD momentum rows from configured aliases.
2. score with trend/momentum:
   - `surging` > `accelerating` > `stable`/`insufficient_history` > `decelerating` > `cooling`
3. choose best-scoring alias.
4. pass others as LiteLLM `fallbacks`.

`insufficient_history` maps to the same neutral posture as `stable`, and should be treated as `observe`.
This keeps neutral states from over-triggering capacity moves while LiteLLM handles provider failover.

## Confidence policy

For operator automation, use confidence gating:

- `normal`: allow proactive actions (`pre_warm`, `consider_deprovision`)
- `low` / `insufficient`: observe-only posture unless you explicitly override

## Notes

- This is intentionally a pre-router. It does not reimplement provider retries.
- This script is intentionally lightweight and copy-pasteable for teams already running:
  - LiteLLM SDK, or
  - LiteLLM proxy/gateway flows.
