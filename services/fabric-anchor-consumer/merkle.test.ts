import { describe, expect, it } from 'vitest';
import { merkleRoot, sha256Hex, stableStringify, toFabricRegionCode } from './index.js';

/** Independently recompute a Merkle root to cross-check the implementation. */
function referenceRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex('');
  let level = leaves.map(sha256Hex);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256Hex(level[i]! + (level[i + 1] ?? level[i]!)));
    }
    level = next;
  }
  return level[0]!;
}

describe('merkleRoot', () => {
  it('returns a 64-char hex root', () => {
    const { root } = merkleRoot(['a', 'b', 'c']);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches an independently computed reference root', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 9, 16, 17]) {
      const leaves = Array.from({ length: n }, (_, i) => `complaint-${i}`);
      expect(merkleRoot(leaves).root).toBe(referenceRoot(leaves));
    }
  });

  it('handles a single leaf', () => {
    const { root, proofs } = merkleRoot(['only']);
    expect(root).toBe(sha256Hex('only'));
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toEqual([]);
  });

  it('handles the empty batch', () => {
    const { root, proofs } = merkleRoot([]);
    expect(root).toBe(sha256Hex(''));
    expect(proofs).toEqual([]);
  });

  it('is deterministic and order-sensitive', () => {
    expect(merkleRoot(['a', 'b']).root).toBe(merkleRoot(['a', 'b']).root);
    expect(merkleRoot(['a', 'b']).root).not.toBe(merkleRoot(['b', 'a']).root);
  });

  /**
   * A single changed leaf must change the root, otherwise anchoring proves nothing.
   */
  it('changes the root when any leaf is tampered with', () => {
    const base = ['a', 'b', 'c', 'd'];
    const original = merkleRoot(base).root;
    for (let i = 0; i < base.length; i++) {
      const tampered = [...base];
      tampered[i] = `${tampered[i]}!`;
      expect(merkleRoot(tampered).root).not.toBe(original);
    }
  });

  it('emits one proof per leaf', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'];
    const { proofs } = merkleRoot(leaves);
    expect(proofs).toHaveLength(leaves.length);
    for (const proof of proofs) {
      for (const step of proof) {
        expect(step.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(['left', 'right']).toContain(step.direction);
      }
    }
  });

  /**
   * Replaying each proof from its leaf must reach the root — this is what makes
   * the on-chain anchor verifiable.
   */
  it('proofs verify back to the root', () => {
    const leaves = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'];
    const { root, proofs } = merkleRoot(leaves);

    leaves.forEach((leaf, i) => {
      let hash = sha256Hex(leaf);
      for (const step of proofs[i]!) {
        hash = step.direction === 'left' ? sha256Hex(step.hash + hash) : sha256Hex(hash + step.hash);
      }
      expect(hash).toBe(root);
    });
  });

  it('odd-sized levels duplicate the last node rather than dropping it', () => {
    // 3 leaves -> the 3rd is paired with itself; the root must still be stable
    // and proofs must verify.
    const leaves = ['x', 'y', 'z'];
    const { root, proofs } = merkleRoot(leaves);
    expect(root).toBe(referenceRoot(leaves));
    let hash = sha256Hex('z');
    for (const step of proofs[2]!) {
      hash = step.direction === 'left' ? sha256Hex(step.hash + hash) : sha256Hex(hash + step.hash);
    }
    expect(hash).toBe(root);
  });
});

describe('sha256Hex', () => {
  it('produces lowercase 64-char hex', () => {
    expect(sha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('stableStringify', () => {
  it('is insensitive to key insertion order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('distinguishes different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('handles nested structures', () => {
    expect(() => stableStringify({ a: { b: [1, 2, { c: 3 }] } })).not.toThrow();
  });
});

describe('toFabricRegionCode', () => {
  it('falls back to UNKNOWN for empty input', () => {
    expect(toFabricRegionCode(null)).toBe('UNKNOWN');
    expect(toFabricRegionCode(undefined)).toBe('UNKNOWN');
    expect(toFabricRegionCode('   ')).toBe('UNKNOWN');
  });

  it('replaces whitespace with hyphens', () => {
    // Keep the hyphenated form within the 10-char cap so this test isolates
    // whitespace handling from truncation (covered separately below).
    expect(toFabricRegionCode('New Delhi')).toBe('New-Delhi');
    expect(toFabricRegionCode('Pune  West')).toBe('Pune-West');
  });

  it('collapses runs of whitespace into a single hyphen', () => {
    expect(toFabricRegionCode('New   Delhi')).toBe('New-Delhi');
  });

  it('strips characters Fabric will not accept', () => {
    expect(toFabricRegionCode('MH/Mum!@#')).toBe('MHMum');
  });

  it('caps the length at 10 characters', () => {
    const code = toFabricRegionCode('ExtremelyLongRegionName');
    expect(code.length).toBe(10);
    // Truncation applies after normalisation, so a hyphenated name is cut too.
    expect(toFabricRegionCode('South-Delhi')).toBe('South-Delh');
  });

  it('keeps short codes intact', () => {
    expect(toFabricRegionCode('MH-MUM')).toBe('MH-MUM');
  });
});
