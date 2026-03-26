# WZRD Velocity Replay — March 8-15, 2026

WZRD tracks download velocity across HuggingFace models on a 10-minute cadence.
This replay shows which models WZRD flagged as accelerating during the week of
March 8-15, and how that signal compared to broader adoption surfaces.

## The dataset

48 markets across 4 platform families (HuggingFace, GitHub, Artificial Analysis,
OpenRouter). Daily snapshots since March 5. Velocity measured as download delta
per day, smoothed via exponential moving average.

## What WZRD detected first

### Qwen 3.5 family — demand migration visible within 24 hours

The Qwen 3.5 model family appeared on HuggingFace around March 7-8.
WZRD began ingesting velocity data on March 8. By March 9, the signal was clear:

```
Model                       Mar 8       Mar 10      Mar 14      Growth
─────────────────────────    ─────────   ─────────   ─────────   ──────
Qwen/Qwen3.5-9B             868,002     1,217,530   1,827,499   +110%
Qwen/Qwen3.5-35B-A3B        1,143,706   1,273,226   1,660,118   +45%
Qwen/Qwen3.5-4B             348,672     560,143     930,557     +167%
Qwen/Qwen3.5-0.8B           406,264     523,289     797,309     +96%
─────────────────────────    ─────────   ─────────   ─────────   ──────
Qwen/Qwen2.5-72B-Instruct   581,623     598,248     721,717     +24%
  (established incumbent)
```

The Qwen3.5-9B model accumulated 960K additional downloads in 6 days —
a sustained +160K/day rate. The established Qwen2.5-72B-Instruct grew at
+23K/day over the same period. The demand shift was 7x faster.

**Operator implication:** A router that weighted Qwen3.5-9B capacity on
March 9 would have been ahead of the demand curve by 5 days relative to
waiting for broader ranking surfaces to reflect the shift.

### Emerging models — early signal on smaller surges

```
Model                                    Mar 8    Mar 15    Growth    Days
─────────────────────────────────────    ──────   ──────    ──────    ────
sarvamai/sarvam-105b                     644      6,715     +943%    8
sarvamai/sarvam-30b                      4,221    29,617    +602%    6
Jackrong/Qwen3.5-27B-Claude-Distilled    9,209    58,809    +539%    8
nvidia/Nemotron-3-Super-120B             2,849    13,104    +360%    4
Lightricks/LTX-2.3                       175,440  500,610   +185%    8
```

Sarvam (Indian multilingual LLM) went from 644 to 6,715 downloads — a 10x
increase that WZRD detected in the first daily snapshot. An inference operator
provisioning Sarvam on March 9 instead of March 15 would have avoided 6 days
of cold-start latency for early adopters.

NVIDIA's Nemotron-3-Super-120B appeared March 12 and grew 360% in 4 days.
LTX-2.3 (video generation) grew 185% over 8 days. Both were visible in WZRD
velocity feeds before they appeared on broader ranking surfaces.

## What this means for routing

The velocity data is not a prediction. It is a measurement of what is already
happening. The value comes from the gap between when demand shifts and when
infrastructure responds:

- **Pre-warming:** Models with accelerating velocity justify keeping warm replicas.
  Cold-start penalty at +160K downloads/day is real user-facing latency.
- **Capacity allocation:** A model growing at 7x the rate of its predecessor
  needs proportionally more inference capacity sooner, not later.
- **Provider selection:** If Qwen3.5-9B is available on multiple providers,
  route to the one that can handle the surge. WZRD velocity is one input
  into that decision.

## What this does NOT prove

- WZRD does not predict which model will "win." It measures current velocity.
- The velocity signal can reverse. Qwen3.5-4B grew 167% in 8 days, then
  download delta dropped to 0 on March 15. Signals are perishable.
- This replay covers 10 days of data. Longer time horizons may show different
  signal quality. The dataset is too small for statistical significance claims.

## Data source

All velocity data from WZRD market snapshots, sampled daily from HuggingFace
download counts via the WZRD ingestor. Reproducible via:

```bash
curl https://api.twzrd.xyz/v1/signals/momentum | jq '.models[] | select(.platform == "huggingface")'
```

Historical snapshots available via the protocol database. On-chain merkle roots
anchor each scoring epoch to Solana for auditability.

---

WZRD Protocol · March 15, 2026 · [api.twzrd.xyz](https://api.twzrd.xyz)
