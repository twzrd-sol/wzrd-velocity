/**
 * NAV (Net Asset Value) helpers for vLOFI share computation.
 *
 * These pure functions mirror the on-chain deposit/settle math so that
 * clients can preview shares received or principal returned without
 * submitting a transaction.
 *
 * NAV BPS domain:
 *   - 10_000 = 1.00x (1 USDC per share, initial NAV)
 *   - 50_000 = 5.00x (max NAV, protocol ceiling)
 *   - 0 = uninitialized (pre-realloc vaults, treated as 10_000)
 */

/** Structured NAV data extracted from a MarketVault. */
export interface NavInfo {
  /** NAV per share in basis points (10_000 = 1.0x). Zero means uninitialized. */
  navPerShareBps: bigint;
  /** Slot at which NAV was last updated on-chain. */
  lastNavUpdateSlot: bigint;
  /** Human-readable share price in USDC terms (navPerShareBps / 10_000). */
  sharePrice: number;
}

const DEFAULT_NAV_BPS = 10_000n;
const BPS_SCALE = 10_000n;

/**
 * Compute the number of vLOFI shares a deposit of `amount` base units will mint.
 *
 * Formula (matches vault.rs deposit_market):
 *   shares = amount * 10_000 / nav_per_share_bps
 *
 * If navPerShareBps is 0 (uninitialized / pre-realloc vault), falls back to
 * the default 10_000 BPS (1:1 ratio).
 */
export function computeSharesForDeposit(
  amount: bigint,
  navPerShareBps: bigint,
): bigint {
  const effectiveNav = navPerShareBps === 0n ? DEFAULT_NAV_BPS : navPerShareBps;
  return (amount * BPS_SCALE) / effectiveNav;
}

/**
 * Compute the USDC principal returned when settling `shares` of vLOFI.
 *
 * Formula (matches vault.rs settle_market):
 *   principal = shares * nav_per_share_bps / 10_000
 *
 * If navPerShareBps is 0 (uninitialized), falls back to 10_000 BPS.
 */
export function computePrincipalForSettle(
  shares: bigint,
  navPerShareBps: bigint,
): bigint {
  const effectiveNav = navPerShareBps === 0n ? DEFAULT_NAV_BPS : navPerShareBps;
  return (shares * effectiveNav) / BPS_SCALE;
}
