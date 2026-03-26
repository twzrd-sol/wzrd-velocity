import { describe, expect, it } from 'vitest';

import { deriveLifecyclePhase } from './accounts.js';

describe('deriveLifecyclePhase', () => {
  it('returns settled when the position is settled', () => {
    expect(deriveLifecyclePhase({ settled: true })).toBe('settled');
  });

  it('returns deposited before any newer root has landed', () => {
    expect(
      deriveLifecyclePhase({
        settled: false,
        positionCreatedAt: '2026-03-17T10:00:00Z',
        latestRootCreatedAt: '2026-03-17T09:59:59Z',
      }),
    ).toBe('deposited');
  });

  it('returns claimable when an unclaimed proof exists after the position', () => {
    expect(
      deriveLifecyclePhase({
        settled: false,
        positionCreatedAt: '2026-03-17T10:00:00Z',
        latestRootCreatedAt: '2026-03-17T10:05:00Z',
        latestProofCreatedAt: '2026-03-17T10:06:00Z',
        proofCumulativeTotalBase: 50n,
        claimedTotalBase: 25n,
        claimableCcmBase: 25n,
      }),
    ).toBe('claimable');
  });

  it('returns claimed when the latest proof is fully claimed', () => {
    expect(
      deriveLifecyclePhase({
        settled: false,
        positionCreatedAt: '2026-03-17T10:00:00Z',
        latestRootCreatedAt: '2026-03-17T10:05:00Z',
        latestProofCreatedAt: '2026-03-17T10:06:00Z',
        proofCumulativeTotalBase: 50n,
        claimedTotalBase: 50n,
        claimableCcmBase: 0n,
      }),
    ).toBe('claimed');
  });

  it('returns accruing when no proof applies to the position yet', () => {
    expect(
      deriveLifecyclePhase({
        settled: false,
        positionCreatedAt: '2026-03-17T10:00:00Z',
        latestRootCreatedAt: '2026-03-17T10:05:00Z',
        latestProofCreatedAt: '2026-03-17T09:55:00Z',
        proofCumulativeTotalBase: 50n,
        claimedTotalBase: 50n,
        claimableCcmBase: 0n,
      }),
    ).toBe('accruing');
  });
});
