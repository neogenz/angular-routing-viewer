import type { RouteGraph } from '../analyzer/types';
import { computeLayout } from './layout';
import { buildHtml } from './templates/viewer.html';

export function renderViewerHtml(graph: RouteGraph): string {
  const layout = computeLayout(graph);
  const layoutObj: Record<string, unknown> = {};
  for (const [id, pos] of layout) layoutObj[id] = pos;
  return buildHtml(JSON.stringify(graph), JSON.stringify(layoutObj));
}
