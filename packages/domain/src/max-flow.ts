/**
 * Max-flow for the even distribution (R11): Edmonds–Karp, plus a feasibility check for flows with lower bounds.
 * Internal to the domain, not exported from the package. Pure and deterministic: the same edges in the same order give
 * the same augmenting paths.
 *
 * Size in R11: ≤ 19 nodes (source, 7 days, ≤ 8 people, sink, plus 2 for lower bounds) and ≤ ~80 edges, flow ≤ 56,
 * so each call is at most 56 BFS passes over ~160 residual edges.
 */

/** A directed edge with a capacity ≥ 0. Nodes are numbered 0 … nodeCount − 1. */
export interface Edge {
  readonly from: number;
  readonly to: number;
  readonly capacity: number;
}

/** A directed edge whose flow must lie in [lower, upper]. */
export interface BoundedEdge {
  readonly from: number;
  readonly to: number;
  readonly lower: number;
  readonly upper: number;
}

/**
 * The maximum flow from `source` to `sink` (Edmonds–Karp: augment along a shortest path found by BFS until none is
 * left). Each edge i is stored with its reverse edge i ^ 1 (capacity 0), so flow can be pushed back along it.
 */
export function maxFlow(
  nodeCount: number,
  edges: readonly Edge[],
  source: number,
  sink: number,
): number {
  const out: number[][] = Array.from({ length: nodeCount }, () => []);
  const head: number[] = []; // head[i]: the node edge i points to
  const residual: number[] = []; // residual[i]: capacity left on edge i
  for (const { from, to, capacity } of edges) {
    at(out, from).push(head.length);
    head.push(to);
    residual.push(capacity);
    at(out, to).push(head.length);
    head.push(from);
    residual.push(0);
  }

  let flow = 0;
  for (;;) {
    // BFS: via[v] = the edge used to reach v (−1 = not reached).
    const via: number[] = new Array<number>(nodeCount).fill(-1);
    const queue: number[] = [source];
    let reached = false;
    for (let q = 0; q < queue.length && !reached; q++) {
      const v = at(queue, q);
      for (const i of at(out, v)) {
        const w = at(head, i);
        if (w !== source && at(via, w) === -1 && at(residual, i) > 0) {
          via[w] = i;
          if (w === sink) {
            reached = true;
            break;
          }
          queue.push(w);
        }
      }
    }
    if (!reached) return flow;

    // The bottleneck along the path, then push it: forward edges lose it, reverse edges gain it.
    let push = Infinity;
    for (let v = sink; v !== source; v = at(head, at(via, v) ^ 1)) {
      push = Math.min(push, at(residual, at(via, v)));
    }
    for (let v = sink; v !== source; v = at(head, at(via, v) ^ 1)) {
      const i = at(via, v);
      residual[i] = at(residual, i) - push;
      residual[i ^ 1] = at(residual, i ^ 1) + push;
    }
    flow += push;
  }
}

/**
 * Whether some flow from `source` to `sink` (of any value) keeps every edge within [lower, upper].
 * Standard reduction to max-flow: each edge keeps capacity upper − lower and its lower bound becomes a demand at its
 * ends; an edge sink → source of unbounded capacity closes the circulation; a new source S′ feeds every node with
 * surplus demand and a new sink T′ drains every node with deficit. Feasible ⇔ the max flow S′ → T′ meets every demand.
 */
export function feasibleFlow(
  nodeCount: number,
  edges: readonly BoundedEdge[],
  source: number,
  sink: number,
): boolean {
  if (edges.some((e) => e.lower > e.upper)) return false;

  const excess: number[] = new Array<number>(nodeCount).fill(0);
  const plain: Edge[] = edges.map(({ from, to, lower, upper }) => {
    excess[to] = at(excess, to) + lower;
    excess[from] = at(excess, from) - lower;
    return { from, to, capacity: upper - lower };
  });
  // "Unbounded": more than every upper bound together can ever carry.
  const unbounded = edges.reduce((sum, e) => sum + e.upper, 1);
  plain.push({ from: sink, to: source, capacity: unbounded });

  const superSource = nodeCount;
  const superSink = nodeCount + 1;
  let demand = 0;
  excess.forEach((x, v) => {
    if (x > 0) {
      plain.push({ from: superSource, to: v, capacity: x });
      demand += x;
    } else if (x < 0) {
      plain.push({ from: v, to: superSink, capacity: -x });
    }
  });
  return maxFlow(nodeCount + 2, plain, superSource, superSink) === demand;
}

/** `array[index]`, failing loudly instead of returning undefined (noUncheckedIndexedAccess). */
function at<T>(array: readonly T[], index: number): T {
  const value = array[index];
  if (value === undefined) throw new Error(`max-flow: no element at ${String(index)}`);
  return value;
}
