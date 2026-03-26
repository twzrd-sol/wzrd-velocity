#!/usr/bin/env bash
# WZRD Routing Replay — velocity growth + agent contribution scorecard.
#
# Modes:
#   ./generate-replay.sh [days=8]                  — velocity replay (default)
#   ./generate-replay.sh --scorecard [days=7]      — agent routing scorecard
#   ./generate-replay.sh --compare [days=7]        — policy A vs B comparison
#
# Requires: SSH access to VPS (vps:2222)

set -euo pipefail

MODE="velocity"
DAYS="8"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scorecard) MODE="scorecard"; shift ;;
    --compare)   MODE="compare"; shift ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then DAYS="$1"; fi
      shift ;;
  esac
done

DB_CMD='docker exec docker-postgres-1 psql -U wzrd -d wzrd -t -A'

run_query() {
  ssh -p 2222 vps "$DB_CMD -F'|' -c \"$1\"" 2>/dev/null
}

# ── Velocity replay ───────────────────────────────────────────────

velocity_replay() {
  echo "# WZRD Velocity Replay — $(date -u +%Y-%m-%d)"
  echo ""
  echo "Top accelerating models over the last ${DAYS} days."
  echo ""
  echo '```'
  echo "Model                                        Start       End         Growth   Days"
  echo "───────────────────────────────────────────   ─────────   ─────────   ──────   ────"

  run_query "
  WITH first_last AS (
    SELECT ms.market_id, m.channel_id,
           MIN(ms.snapshot_at) as first_day,
           MAX(ms.snapshot_at) as last_day,
           (SELECT source_metric_1 FROM market_snapshots WHERE market_id = ms.market_id ORDER BY snapshot_at LIMIT 1) as first_val,
           (SELECT source_metric_1 FROM market_snapshots WHERE market_id = ms.market_id ORDER BY snapshot_at DESC LIMIT 1) as last_val,
           COUNT(*) as days
    FROM market_snapshots ms
    JOIN markets m ON m.market_id = ms.market_id
    WHERE m.platform = 'huggingface'
      AND ms.snapshot_at >= CURRENT_DATE - INTERVAL '${DAYS} days'
    GROUP BY ms.market_id, m.channel_id
    HAVING COUNT(*) >= 3
  )
  SELECT channel_id, first_val, last_val,
         CASE WHEN first_val > 0 THEN ROUND(((last_val::numeric - first_val) / first_val * 100), 1) ELSE 0 END as growth_pct,
         days
  FROM first_last
  WHERE first_val > 100
  ORDER BY growth_pct DESC
  LIMIT 15;" | while IFS='|' read -r name first last growth days; do
    printf "%-45s %11s %11s %7s%%  %4s\n" "$name" "$first" "$last" "$growth" "$days"
  done

  echo '```'
}

# ── Agent routing scorecard ───────────────────────────────────────

routing_scorecard() {
  echo "# WZRD Routing Scorecard — $(date -u +%Y-%m-%d)"
  echo ""
  echo "Agent contribution quality over the last ${DAYS} days."
  echo ""
  echo '```'
  echo "Model                                     Reports  AvgQuality  AvgLatency  AvgCost    ValueScore  Source"
  echo "────────────────────────────────────────   ───────  ──────────  ──────────  ─────────  ──────────  ──────────────"

  run_query "
  SELECT model_id,
         COUNT(*)::int as reports,
         ROUND(COALESCE(AVG(quality_score), 0)::numeric, 3) as avg_q,
         ROUND(COALESCE(AVG(latency_ms), 0)::numeric, 0) as avg_lat,
         ROUND(COALESCE(AVG(cost_usd), 0)::numeric, 6) as avg_cost,
         CASE WHEN AVG(cost_usd) > 0 AND COUNT(*) >= 3
              THEN ROUND((AVG(quality_score) / AVG(cost_usd))::numeric, 1)
              ELSE NULL END as value_score,
         COALESCE(metadata->'wzrd'->>'source', 'unknown') as source
  FROM agent_contributions
  WHERE created_at > NOW() - INTERVAL '${DAYS} days'
  GROUP BY model_id, source
  ORDER BY reports DESC
  LIMIT 20;" | while IFS='|' read -r model reports avg_q avg_lat avg_cost vs source; do
    printf "%-42s %7s  %10s  %8sms  \$%8s  %10s  %s\n" \
      "$model" "$reports" "$avg_q" "$avg_lat" "$avg_cost" "${vs:---}" "$source"
  done

  echo '```'
}

# ── Policy comparison ─────────────────────────────────────────────

policy_compare() {
  echo "# WZRD Policy Comparison — $(date -u +%Y-%m-%d)"
  echo ""
  echo "Exploration vs exploitation picks over the last ${DAYS} days."
  echo ""
  echo '```'
  echo "Pick Type       Reports  AvgQuality  AvgLatency  AvgCost    UniqueModels"
  echo "──────────────  ───────  ──────────  ──────────  ─────────  ────────────"

  run_query "
  SELECT
    CASE WHEN (metadata->'wzrd'->>'exploration')::boolean IS TRUE THEN 'exploration'
         ELSE 'exploitation' END as pick_type,
    COUNT(*)::int as reports,
    ROUND(COALESCE(AVG(quality_score), 0)::numeric, 3) as avg_q,
    ROUND(COALESCE(AVG(latency_ms), 0)::numeric, 0) as avg_lat,
    ROUND(COALESCE(AVG(cost_usd), 0)::numeric, 6) as avg_cost,
    COUNT(DISTINCT model_id)::int as unique_models
  FROM agent_contributions
  WHERE created_at > NOW() - INTERVAL '${DAYS} days'
    AND metadata->'wzrd' IS NOT NULL
  GROUP BY pick_type
  ORDER BY pick_type;" | while IFS='|' read -r ptype reports avg_q avg_lat avg_cost unique; do
    printf "%-16s %7s  %10s  %8sms  \$%8s  %12s\n" \
      "$ptype" "$reports" "$avg_q" "$avg_lat" "$avg_cost" "$unique"
  done

  echo '```'
  echo ""
  echo "## By Source"
  echo ""
  echo '```'
  echo "Source            Reports  Exploration%  AvgQuality  UniqueModels"
  echo "────────────────  ───────  ────────────  ──────────  ────────────"

  run_query "
  SELECT
    COALESCE(metadata->'wzrd'->>'source', 'unknown') as source,
    COUNT(*)::int as reports,
    ROUND(100.0 * COUNT(*) FILTER (WHERE (metadata->'wzrd'->>'exploration')::boolean IS TRUE) / GREATEST(COUNT(*), 1), 1) as explore_pct,
    ROUND(COALESCE(AVG(quality_score), 0)::numeric, 3) as avg_q,
    COUNT(DISTINCT model_id)::int as unique_models
  FROM agent_contributions
  WHERE created_at > NOW() - INTERVAL '${DAYS} days'
    AND metadata->'wzrd' IS NOT NULL
  GROUP BY source
  ORDER BY reports DESC;" | while IFS='|' read -r source reports explore_pct avg_q unique; do
    printf "%-18s %7s  %11s%%  %10s  %12s\n" \
      "$source" "$reports" "$explore_pct" "$avg_q" "$unique"
  done

  echo '```'
}

# ── Dispatch ──────────────────────────────────────────────────────

case "$MODE" in
  velocity)  velocity_replay ;;
  scorecard) routing_scorecard ;;
  compare)   policy_compare ;;
esac

echo ""
echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) from WZRD agent contributions."
echo "Live data: https://api.twzrd.xyz/v1/signals/momentum/premium"
