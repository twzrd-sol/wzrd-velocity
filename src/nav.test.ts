/**
 * Unit tests for NAV computation helpers (computeSharesForDeposit, computePrincipalForSettle).
 */

import { describe, it, expect } from 'vitest';
import { computeSharesForDeposit, computePrincipalForSettle } from './nav.js';
import type { NavInfo } from './nav.js';

// ── computeSharesForDeposit ──────────────────────────────

describe('computeSharesForDeposit', () => {
  it('returns 1:1 shares at default NAV (10_000 BPS)', () => {
    const shares = computeSharesForDeposit(1_000_000n, 10_000n);
    expect(shares).toBe(1_000_000n);
  });

  it('returns half shares at 2x NAV (20_000 BPS)', () => {
    const shares = computeSharesForDeposit(1_000_000n, 20_000n);
    expect(shares).toBe(500_000n);
  });

  it('handles zero NAV fallback — treats as 10_000 BPS', () => {
    // zero nav fallback: uninitialized vault should behave like 1:1
    const shares = computeSharesForDeposit(1_000_000n, 0n);
    expect(shares).toBe(1_000_000n);
  });

  it('handles max NAV of 50_000 BPS (5.0x)', () => {
    // max nav: 50_000 BPS ceiling
    const shares = computeSharesForDeposit(5_000_000n, 50_000n);
    expect(shares).toBe(1_000_000n);
  });

  it('returns 0 shares for 0 deposit amount', () => {
    const shares = computeSharesForDeposit(0n, 10_000n);
    expect(shares).toBe(0n);
  });

  it('handles large deposit without overflow', () => {
    // overflow test: large amount should not throw
    const amount = 1_000_000_000_000n; // 1M USDC in base units
    const shares = computeSharesForDeposit(amount, 10_000n);
    expect(shares).toBe(amount);
  });

  it('truncates fractional shares (integer division)', () => {
    // 3 base units at 2x NAV = 1.5 → truncates to 1
    const shares = computeSharesForDeposit(3n, 20_000n);
    expect(shares).toBe(1n);
  });
});

// ── computePrincipalForSettle ─────────────────────────────

describe('computePrincipalForSettle', () => {
  it('returns 1:1 principal at default NAV (10_000 BPS)', () => {
    const principal = computePrincipalForSettle(1_000_000n, 10_000n);
    expect(principal).toBe(1_000_000n);
  });

  it('returns double principal at 2x NAV (20_000 BPS)', () => {
    const principal = computePrincipalForSettle(1_000_000n, 20_000n);
    expect(principal).toBe(2_000_000n);
  });

  it('handles zero NAV fallback — treats as 10_000 BPS', () => {
    // zero nav fallback
    const principal = computePrincipalForSettle(1_000_000n, 0n);
    expect(principal).toBe(1_000_000n);
  });

  it('handles max NAV of 50_000 BPS (5.0x)', () => {
    // max nav: 50_000 BPS ceiling
    const principal = computePrincipalForSettle(1_000_000n, 50_000n);
    expect(principal).toBe(5_000_000n);
  });

  it('returns 0 principal for 0 shares', () => {
    const principal = computePrincipalForSettle(0n, 10_000n);
    expect(principal).toBe(0n);
  });

  it('handles large shares without overflow', () => {
    // overflow test: large shares
    const shares = 1_000_000_000_000n;
    const principal = computePrincipalForSettle(shares, 10_000n);
    expect(principal).toBe(shares);
  });
});

// ── NavInfo type ─────────────────────────────────────────

describe('NavInfo type', () => {
  it('can be constructed with valid fields', () => {
    const info: NavInfo = {
      navPerShareBps: 15_000n,
      lastNavUpdateSlot: 405_000_000n,
      sharePrice: 1.5,
    };
    expect(info.navPerShareBps).toBe(15_000n);
    expect(info.lastNavUpdateSlot).toBe(405_000_000n);
    expect(info.sharePrice).toBe(1.5);
  });
});

// ── Round-trip deposit→settle ────────────────────────────

describe('deposit-settle round trip', () => {
  it('deposit then settle at same NAV returns original amount', () => {
    const amount = 1_000_000n;
    const nav = 12_500n;
    const shares = computeSharesForDeposit(amount, nav);
    const principal = computePrincipalForSettle(shares, nav);
    // Due to integer division, principal <= amount
    expect(principal).toBeLessThanOrEqual(amount);
    // But should be close (within 1 base unit rounding)
    expect(amount - principal).toBeLessThan(nav);
  });
});
