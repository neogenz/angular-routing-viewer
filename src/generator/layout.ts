import type { RouteGraph, RouteNode } from '../analyzer/types';

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_W = 280;
const CARD_H = 140;
const GAP_H = 40;  // horizontal gap between siblings
const GAP_V = 80;  // vertical gap between levels
const START_X = 100;
const START_Y = 100;

function subtreeWidth(node: RouteNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenTotal = node.children.reduce(
    (sum, c) => sum + subtreeWidth(c),
    0
  );
  return Math.max(CARD_W, childrenTotal + GAP_H * (node.children.length - 1));
}

function placeNode(
  node: RouteNode,
  leftX: number,
  y: number,
  result: Map<string, NodePosition>
): void {
  const sw = subtreeWidth(node);
  const x = leftX + sw / 2 - CARD_W / 2;

  result.set(node.id, { x, y, width: CARD_W, height: CARD_H });

  let cursor = leftX;
  for (const child of node.children) {
    placeNode(child, cursor, y + CARD_H + GAP_V, result);
    cursor += subtreeWidth(child) + GAP_H;
  }
}

export function computeLayout(graph: RouteGraph): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();

  // Compute total width of all root subtrees to center them horizontally
  let cursor = START_X;
  for (const root of graph.roots) {
    placeNode(root, cursor, START_Y, result);
    cursor += subtreeWidth(root) + GAP_H;
  }

  return result;
}
