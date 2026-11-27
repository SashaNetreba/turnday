// Unit tests for the max-flow helper behind R11 (internal, not a business rule — no rule ID in the titles).
import { describe, expect, it } from 'vitest';

import { feasibleFlow, maxFlow, type BoundedEdge, type Edge } from './max-flow.js';

const e = (from: number, to: number, capacity: number): Edge => ({ from, to, capacity });
const b = (from: number, to: number, lower: number, upper: number): BoundedEdge => ({
  from,
  to,
  lower,
  upper,
});

describe('max-flow (Edmonds–Karp)', () => {
  it('a single path carries its smallest capacity', () => {
    expect(maxFlow(3, [e(0, 1, 5), e(1, 2, 3)], 0, 2)).toBe(3);
  });

  it('no path from source to sink → 0', () => {
    expect(maxFlow(3, [e(0, 1, 5)], 0, 2)).toBe(0);
  });

  it('the textbook network (CLRS fig. 26.1) has max flow 23', () => {
    // s=0, v1..v4 = 1..4, t=5
    const edges = [
      e(0, 1, 16),
      e(0, 2, 13),
      e(2, 1, 4),
      e(1, 3, 12),
      e(3, 2, 9),
      e(2, 4, 14),
      e(4, 3, 7),
      e(3, 5, 20),
      e(4, 5, 4),
    ];
    expect(maxFlow(6, edges, 0, 5)).toBe(23);
  });

  it('undoes the first shortest path through a reverse edge', () => {
    // s=0, a=1, b=2, c=3, d=4, t=5. BFS (edges in this order) first finds s→a→c→t; then s→b→c needs the
    // reverse edge c→a to reach a→d→t. Without residual edges the result would be 1.
    const edges = [
      e(0, 1, 1),
      e(0, 2, 1),
      e(1, 3, 1),
      e(1, 4, 1),
      e(2, 3, 1),
      e(3, 5, 1),
      e(4, 5, 1),
    ];
    expect(maxFlow(6, edges, 0, 5)).toBe(2);
  });

  it('a bipartite assignment: 3 days × 2 people, each person at most 2 shifts → 4 of 5 places', () => {
    // s=0, days 1..3 (places 2, 2, 1), people 4..5, t=6
    const edges = [
      e(0, 1, 2),
      e(0, 2, 2),
      e(0, 3, 1),
      ...[1, 2, 3].flatMap((d) => [e(d, 4, 1), e(d, 5, 1)]),
      e(4, 6, 2),
      e(5, 6, 2),
    ];
    expect(maxFlow(7, edges, 0, 6)).toBe(4);
  });
});

describe('feasible flow with lower bounds', () => {
  it('a lower bound the network can carry is feasible', () => {
    expect(feasibleFlow(3, [b(0, 1, 2, 5), b(1, 2, 0, 3)], 0, 2)).toBe(true);
  });

  it('a lower bound above what the next edge can carry is infeasible', () => {
    expect(feasibleFlow(3, [b(0, 1, 4, 5), b(1, 2, 0, 3)], 0, 2)).toBe(false);
  });

  it('lower > upper on an edge is infeasible', () => {
    expect(feasibleFlow(2, [b(0, 1, 2, 1)], 0, 1)).toBe(false);
  });

  it('an exact total [R, R] is met only when the network carries exactly R', () => {
    // src=0 → s=1 [R, R]; s → a=2, b=3 [0, 1] each; a → t=4 [1, 1], b → t [0, 1]
    const net = (r: number): BoundedEdge[] => [
      b(0, 1, r, r),
      b(1, 2, 0, 1),
      b(1, 3, 0, 1),
      b(2, 4, 1, 1),
      b(3, 4, 0, 1),
    ];
    expect(feasibleFlow(5, net(0), 0, 4)).toBe(false); // a must carry 1
    expect(feasibleFlow(5, net(1), 0, 4)).toBe(true);
    expect(feasibleFlow(5, net(2), 0, 4)).toBe(true);
    expect(feasibleFlow(5, net(3), 0, 4)).toBe(false);
  });

  it('with no lower bounds a zero flow is feasible, even with the sink unreachable', () => {
    expect(feasibleFlow(3, [b(0, 1, 0, 5)], 0, 2)).toBe(true);
  });
});
