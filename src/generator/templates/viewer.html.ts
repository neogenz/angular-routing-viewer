function safeJson(json: string): string {
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

export function buildHtml(graphJson: string, positionsJson: string): string {
  const safeGraph = safeJson(graphJson);
  const safeLayout = safeJson(positionsJson);

  // The embedded JS is written as a plain string to avoid template literal escaping issues.
  // All JS uses regular strings and avoids backticks where possible.
  const embeddedScript = buildScript();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Angular Routing Viewer</title>
  <style>
${CSS}
  </style>
</head>
<body>
  <header class="toolbar">
    <h1>Angular Routing</h1>
    <input id="search" placeholder="Search path, component, guard..." autocomplete="off"/>
    <button id="export-json">Export JSON</button>
    <button id="fit-view">Fit</button>
  </header>
  <aside class="legend" id="legend">
    <div class="legend-title">Route types</div>
    <div class="legend-item"><span class="legend-chip" style="color:#017BFF;background:#E6F2FF">Route</span></div>
    <div class="legend-item"><span class="legend-chip" style="color:#7C3AED;background:#EDE9FE">Lazy module</span></div>
    <div class="legend-item"><span class="legend-chip" style="color:#0891B2;background:#CFFAFE">Lazy component</span></div>
    <div class="legend-item"><span class="legend-chip" style="color:#EA580C;background:#FFEDD5">Redirect</span></div>
    <div class="legend-item"><span class="legend-chip" style="color:#6B7280;background:#E5E7EB">Wildcard</span></div>
  </aside>
  <div class="canvas-viewport pan-mode" id="canvasViewport">
    <div class="canvas-world" id="canvasWorld">
      <svg class="connections-svg" id="connectionsSvg"></svg>
    </div>
  </div>
  <aside class="side-panel" id="sidePanel" hidden></aside>
  <script>
    window.__GRAPH__ = ${safeGraph};
    window.__LAYOUT__ = ${safeLayout};
${embeddedScript}
  </script>
</body>
</html>`;
}

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  height: 100vh;
  overflow: hidden;
  background: #F8F8FA;
}

.toolbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 60px;
  background: #FFFFFF;
  border-bottom: 1px solid #E5E7EB;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  z-index: 10;
}
.toolbar h1 {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin: 0;
  white-space: nowrap;
}
.toolbar input {
  flex: 1;
  max-width: 400px;
  padding: 8px 12px;
  border: 1px solid #D6D6D6;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.toolbar input:focus {
  border-color: #017BFF;
}
.toolbar button {
  padding: 6px 12px;
  border: 1px solid #D6D6D6;
  background: #FAFAFA;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.toolbar button:hover {
  background: #F0F0F0;
}

.legend {
  position: fixed;
  top: 80px;
  left: 20px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  z-index: 5;
  font-size: 12px;
}
.legend-title {
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.legend-item {
  margin-bottom: 4px;
}
.legend-chip {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.canvas-viewport {
  position: fixed;
  top: 60px;
  left: 0;
  width: 100%;
  height: calc(100% - 60px);
  overflow: hidden;
  background-color: #F8F8FA;
  background-image: radial-gradient(circle, #E5E5E6 1.2px, transparent 1.2px);
  background-size: 18px 18px;
}
.canvas-viewport.pan-mode {
  cursor: grab;
}
.canvas-viewport.panning {
  cursor: grabbing;
}

.canvas-world {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  transform-origin: 0 0;
}

.node-card {
  position: absolute;
  cursor: grab;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  background: none;
  border: none;
  box-shadow: none;
  border-radius: 0;
  width: 280px;
}
.node-card.dragging {
  cursor: grabbing;
  z-index: 100;
}

.node-card-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 8px;
  border-radius: 5px;
  margin-bottom: 6px;
}

.node-card-block {
  width: 280px;
  border-radius: 22px;
  border: 0.5px solid #D6D6D6;
  background: #F3F3F4;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06), inset 0 0 0 1px #ffffff;
  overflow: hidden;
}

.node-card-upper {
  background: #FAFAFA;
  padding: 4px;
  border-radius: 22px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.04);
}

.node-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px 8px 0 12px;
  margin-bottom: 8px;
}

.node-card-title {
  font-size: 14px;
  font-weight: 500;
  color: #2a2530;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.node-card-body {
  padding: 0 12px 10px;
  font-size: 12px;
  color: #5a5060;
  line-height: 1.5;
}

.node-meta {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 11px;
  color: #6B7280;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0;
}

.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
}
.badge-guard { background: #DCFCE7; color: #15803D; }
.badge-resolver { background: #DBEAFE; color: #1D4ED8; }
.badge-data { background: #E5E7EB; color: #374151; }
.badge-provider { background: #F3E8FF; color: #6D28D9; }

.node-card-footer {
  padding: 8px 12px;
  border-top: 1px solid #EEE;
  font-size: 11px;
  color: #6B7280;
  font-family: 'SF Mono', Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connections-svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  overflow: visible;
}

.connection-line {
  stroke: #D6D6D6;
  stroke-width: 1.5;
  fill: none;
}
.connection-dot {
  fill: #ffffff;
  stroke: #D6D6D6;
  stroke-width: 1.5;
}

.node-card.highlight .node-card-block {
  border-color: #017BFF;
  box-shadow: 0 4px 16px rgba(1,123,255,0.15), inset 0 0 0 1px #ffffff;
}
.node-card.dimmed {
  opacity: 0.35;
}
.connection-line.highlight {
  stroke: #017BFF;
  stroke-width: 2;
}
.connection-line.dimmed {
  opacity: 0.2;
}

.side-panel {
  position: fixed;
  top: 60px; right: 0;
  width: 380px;
  height: calc(100% - 60px);
  background: white;
  border-left: 1px solid #E5E7EB;
  overflow-y: auto;
  padding: 20px;
  z-index: 8;
}
.side-panel[hidden] { display: none; }

.panel-close {
  float: right;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #6B7280;
  line-height: 1;
  padding: 2px 4px;
}
.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 4px;
  word-break: break-all;
}
.panel-type-chip {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  margin-bottom: 16px;
}
.panel-section {
  margin-bottom: 16px;
}
.panel-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6B7280;
  margin-bottom: 6px;
}
.panel-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #374151;
}
.panel-row-label {
  font-weight: 500;
  color: #6B7280;
  min-width: 80px;
}
.panel-code {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 11px;
  background: #F3F4F6;
  padding: 8px 10px;
  border-radius: 6px;
  word-break: break-all;
  color: #374151;
}
.panel-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
`;

function buildScript(): string {
  // Written as a plain string — no template literal interpolation inside JS logic.
  // Only the data injection uses template literals (done in buildHtml above).
  return `
(function() {
  var graph = window.__GRAPH__;
  var layout = window.__LAYOUT__;

  var canvasOffset = { x: 0, y: 0 };
  var canvasScale = 1;
  var selectedId = null;
  var positions = {}; // mutable node positions (for drag)

  // Copy layout positions into mutable positions map
  for (var id in layout) {
    positions[id] = { x: layout[id].x, y: layout[id].y, width: layout[id].width, height: layout[id].height };
  }

  // Flatten all nodes into a list
  var allNodes = [];
  function collectNodes(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      allNodes.push(nodes[i]);
      collectNodes(nodes[i].children);
    }
  }
  collectNodes(graph.roots);

  // Build parent map: childId -> parentId
  var parentMap = {};
  function buildParentMap(nodes, parentId) {
    for (var i = 0; i < nodes.length; i++) {
      if (parentId !== null) parentMap[nodes[i].id] = parentId;
      buildParentMap(nodes[i].children, nodes[i].id);
    }
  }
  buildParentMap(graph.roots, null);

  // Build descendants set for a node
  function getDescendants(nodeId) {
    var result = new Set();
    var nodeMap = {};
    for (var i = 0; i < allNodes.length; i++) nodeMap[allNodes[i].id] = allNodes[i];
    var stack = [nodeId];
    while (stack.length > 0) {
      var curr = stack.pop();
      var n = nodeMap[curr];
      if (!n) continue;
      for (var j = 0; j < n.children.length; j++) {
        result.add(n.children[j].id);
        stack.push(n.children[j].id);
      }
    }
    return result;
  }

  // Get ancestor chain
  function getAncestors(nodeId) {
    var result = new Set();
    var curr = nodeId;
    while (parentMap[curr]) {
      curr = parentMap[curr];
      result.add(curr);
    }
    return result;
  }

  var TYPE_STYLES = {
    'route': { color: '#017BFF', bg: '#E6F2FF', label: 'Route' },
    'lazy-module': { color: '#7C3AED', bg: '#EDE9FE', label: 'Lazy module' },
    'lazy-component': { color: '#0891B2', bg: '#CFFAFE', label: 'Lazy component' },
    'redirect': { color: '#EA580C', bg: '#FFEDD5', label: 'Redirect' },
    'wildcard': { color: '#6B7280', bg: '#E5E7EB', label: 'Wildcard' }
  };

  var TYPE_ICONS = {
    'route': '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M 4 14 L 14 4"/></svg>',
    'lazy-module': '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M 8 2 L 3 9 L 8 9 L 6 14 L 13 6 L 8 6 Z"/></svg>',
    'lazy-component': '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M 8 2 V 11 M 5 8 L 8 11 L 11 8 M 3 14 H 13"/></svg>',
    'redirect': '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M 3 8 H 13 M 9 4 L 13 8 L 9 12"/></svg>',
    'wildcard': '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M 8 3 V 13 M 3.5 5.5 L 12.5 10.5 M 12.5 5.5 L 3.5 10.5"/></svg>'
  };

  function basename(p) {
    if (!p) return '';
    return p.split('/').pop() || p;
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderBadges(node) {
    var parts = [];
    var guards = [].concat(node.canActivate || [], node.canMatch || [], node.canActivateChild || [], node.canDeactivate || [], node.canLoad || []);
    for (var i = 0; i < guards.length; i++) {
      parts.push('<span class="badge badge-guard">' + escHtml(guards[i]) + '</span>');
    }
    if (node.resolve) {
      var keys = Object.keys(node.resolve);
      for (var i = 0; i < keys.length; i++) {
        parts.push('<span class="badge badge-resolver">' + escHtml(keys[i]) + '</span>');
      }
    }
    if (node.data) {
      var dkeys = Object.keys(node.data);
      for (var i = 0; i < dkeys.length; i++) {
        parts.push('<span class="badge badge-data">' + escHtml(dkeys[i]) + '</span>');
      }
    }
    if (node.providers && node.providers.length > 0) {
      for (var i = 0; i < node.providers.length; i++) {
        parts.push('<span class="badge badge-provider">' + escHtml(node.providers[i]) + '</span>');
      }
    }
    if (parts.length === 0) return '';
    return '<div class="node-badges">' + parts.join('') + '</div>';
  }

  function renderCardHtml(node) {
    var ts = TYPE_STYLES[node.type] || TYPE_STYLES['route'];
    var icon = TYPE_ICONS[node.type] || TYPE_ICONS['route'];
    var pathLabel = node.path === '' ? '<empty>' : escHtml(node.path);

    var bodyLines = '';
    bodyLines += '<div class="node-meta">' + escHtml(node.fullPath) + '</div>';

    if (node.component) {
      bodyLines += '<div>' + escHtml(node.component) + '</div>';
    }
    if (node.loadComponent) {
      var lcFile = node.loadComponent.resolvedFile ? basename(node.loadComponent.resolvedFile) : node.loadComponent.source;
      bodyLines += '<div><span style="color:#0891B2;font-size:11px">[lazy component]</span> ' + escHtml(lcFile) + '</div>';
    }
    if (node.loadChildren) {
      var lmFile = node.loadChildren.resolvedFile ? basename(node.loadChildren.resolvedFile) : node.loadChildren.source;
      bodyLines += '<div><span style="color:#7C3AED;font-size:11px">[lazy module]</span> ' + escHtml(lmFile) + '</div>';
    }
    if (node.redirectTo) {
      bodyLines += '<div>&#8594; ' + escHtml(node.redirectTo) + '</div>';
    }

    bodyLines += renderBadges(node);

    if (node.title) {
      bodyLines += '<div style="font-size:11px;color:#9CA3AF;margin-top:2px">Title: ' + escHtml(node.title.source) + '</div>';
    }

    var footerText = basename(node.sourceFile) + ':' + node.sourceLine;

    return (
      '<div class="node-card-label" style="color:' + ts.color + ';background:' + ts.bg + '">' +
        icon + ts.label +
      '</div>' +
      '<div class="node-card-block">' +
        '<div class="node-card-upper">' +
          '<div class="node-card-header">' +
            '<div class="node-card-title">' + pathLabel + '</div>' +
          '</div>' +
          '<div class="node-card-body">' + bodyLines + '</div>' +
        '</div>' +
        '<div class="node-card-footer">' + escHtml(footerText) + '</div>' +
      '</div>'
    );
  }

  // DOM refs
  var world = document.getElementById('canvasWorld');
  var viewport = document.getElementById('canvasViewport');
  var svg = document.getElementById('connectionsSvg');
  var sidePanel = document.getElementById('sidePanel');
  var searchInput = document.getElementById('search');

  // Render all node cards
  var cardEls = {};
  for (var i = 0; i < allNodes.length; i++) {
    var node = allNodes[i];
    var pos = positions[node.id];
    if (!pos) continue;

    var div = document.createElement('div');
    div.className = 'node-card';
    div.dataset.id = node.id;
    div.style.left = pos.x + 'px';
    div.style.top = pos.y + 'px';
    div.innerHTML = renderCardHtml(node);
    world.appendChild(div);
    cardEls[node.id] = div;
  }

  // Collect all edges: list of [parentId, childId]
  var edges = [];
  function collectEdges(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      for (var j = 0; j < nodes[i].children.length; j++) {
        edges.push([nodes[i].id, nodes[i].children[j].id]);
      }
      collectEdges(nodes[i].children);
    }
  }
  collectEdges(graph.roots);

  function getCardCenter(id) {
    var pos = positions[id];
    var W = pos.width || 280;
    var H = pos.height || 140;
    return {
      bx: pos.x + W / 2,
      by: pos.y + H,
      tx: pos.x + W / 2,
      ty: pos.y
    };
  }

  function renderConnections() {
    // Clear existing
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    for (var i = 0; i < edges.length; i++) {
      var parentId = edges[i][0];
      var childId = edges[i][1];
      if (!positions[parentId] || !positions[childId]) continue;

      var c = getCardCenter(parentId);
      var ch = getCardCenter(childId);
      var sx = c.bx, sy = c.by;
      var tx = ch.tx, ty = ch.ty;
      var my = (sy + ty) / 2;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'connection-line');
      path.dataset.parent = parentId;
      path.dataset.child = childId;
      path.setAttribute('d', 'M ' + sx + ',' + sy + ' C ' + sx + ',' + my + ' ' + tx + ',' + my + ' ' + tx + ',' + ty);
      svg.appendChild(path);

      // Source dot
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'connection-dot');
      dot.dataset.parent = parentId;
      dot.dataset.child = childId;
      dot.setAttribute('cx', String(sx));
      dot.setAttribute('cy', String(sy));
      dot.setAttribute('r', '3');
      svg.appendChild(dot);
    }
  }

  renderConnections();

  // --- Selection & highlight ---
  function applySelectionState(nodeId) {
    var highlightIds = new Set();
    if (nodeId) {
      highlightIds.add(nodeId);
      var anc = getAncestors(nodeId);
      anc.forEach(function(id) { highlightIds.add(id); });
      var desc = getDescendants(nodeId);
      desc.forEach(function(id) { highlightIds.add(id); });
    }

    for (var id in cardEls) {
      var el = cardEls[id];
      el.classList.remove('highlight', 'dimmed');
      if (nodeId) {
        if (highlightIds.has(id)) {
          el.classList.add('highlight');
        } else {
          el.classList.add('dimmed');
        }
      }
    }

    var lines = svg.querySelectorAll('.connection-line, .connection-dot');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      line.classList.remove('highlight', 'dimmed');
      if (nodeId) {
        var p = line.dataset.parent;
        var ch = line.dataset.child;
        if (highlightIds.has(p) && highlightIds.has(ch)) {
          line.classList.add('highlight');
        } else {
          line.classList.add('dimmed');
        }
      }
    }
  }

  function renderSidePanel(node) {
    if (!node) {
      sidePanel.hidden = true;
      return;
    }
    var ts = TYPE_STYLES[node.type] || TYPE_STYLES['route'];

    var html = '<button class="panel-close" id="panelClose">&#x2715;</button>';
    html += '<div class="panel-title">' + escHtml(node.path || '<empty>') + '</div>';
    html += '<div class="panel-type-chip" style="color:' + ts.color + ';background:' + ts.bg + '">' + ts.label + '</div>';

    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Information</div>';
    html += '<div class="panel-row"><span class="panel-row-label">ID</span><span>' + escHtml(node.id) + '</span></div>';
    html += '<div class="panel-row"><span class="panel-row-label">Path</span><span>' + escHtml(node.path) + '</span></div>';
    html += '<div class="panel-row"><span class="panel-row-label">Full path</span><span style="font-family:monospace;font-size:11px">' + escHtml(node.fullPath) + '</span></div>';
    html += '<div class="panel-row"><span class="panel-row-label">Type</span><span>' + escHtml(node.type) + '</span></div>';
    if (node.pathMatch) html += '<div class="panel-row"><span class="panel-row-label">pathMatch</span><span>' + escHtml(node.pathMatch) + '</span></div>';
    if (node.outlet) html += '<div class="panel-row"><span class="panel-row-label">outlet</span><span>' + escHtml(node.outlet) + '</span></div>';
    if (node.matcher) html += '<div class="panel-row"><span class="panel-row-label">matcher</span><span>' + escHtml(node.matcher) + '</span></div>';
    if (node.runGuardsAndResolvers) html += '<div class="panel-row"><span class="panel-row-label">runGuards</span><span>' + escHtml(node.runGuardsAndResolvers) + '</span></div>';
    html += '</div>';

    if (node.component) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Component</div>';
      html += '<div class="panel-code">' + escHtml(node.component) + '</div>';
      html += '</div>';
    }

    if (node.loadComponent) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Lazy component</div>';
      html += '<div class="panel-code">' + escHtml(node.loadComponent.source) + '</div>';
      if (node.loadComponent.resolvedFile) {
        html += '<div class="panel-row" style="margin-top:4px"><span class="panel-row-label">Fichier</span><span style="font-family:monospace;font-size:11px">' + escHtml(node.loadComponent.resolvedFile) + '</span></div>';
      }
      html += '</div>';
    }

    if (node.loadChildren) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Lazy module</div>';
      html += '<div class="panel-code">' + escHtml(node.loadChildren.source) + '</div>';
      if (node.loadChildren.resolvedFile) {
        html += '<div class="panel-row" style="margin-top:4px"><span class="panel-row-label">Fichier</span><span style="font-family:monospace;font-size:11px">' + escHtml(node.loadChildren.resolvedFile) + '</span></div>';
      }
      html += '</div>';
    }

    if (node.redirectTo) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Redirect</div>';
      html += '<div class="panel-code">' + escHtml(node.redirectTo) + '</div>';
      html += '</div>';
    }

    if (node.title) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Title</div>';
      html += '<div class="panel-row"><span class="panel-row-label">Source</span><span>' + escHtml(node.title.source) + '</span></div>';
      html += '<div class="panel-row"><span class="panel-row-label">Type</span><span>' + escHtml(node.title.kind) + '</span></div>';
      html += '</div>';
    }

    var guards = [].concat(node.canActivate || [], node.canMatch || [], node.canActivateChild || [], node.canDeactivate || [], node.canLoad || []);
    if (guards.length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Guards</div>';
      html += '<div class="panel-badges">';
      for (var i = 0; i < guards.length; i++) html += '<span class="badge badge-guard">' + escHtml(guards[i]) + '</span>';
      html += '</div></div>';
    }

    if (node.resolve && Object.keys(node.resolve).length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Resolvers</div>';
      html += '<div class="panel-badges">';
      var rkeys = Object.keys(node.resolve);
      for (var i = 0; i < rkeys.length; i++) {
        html += '<span class="badge badge-resolver">' + escHtml(rkeys[i]) + ': ' + escHtml(node.resolve[rkeys[i]]) + '</span>';
      }
      html += '</div></div>';
    }

    if (node.data && Object.keys(node.data).length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Data</div>';
      html += '<div class="panel-code" style="white-space:pre-wrap;word-break:break-all">' + escHtml(JSON.stringify(node.data, null, 2)) + '</div>';
      html += '</div>';
    }

    if (node.providers && node.providers.length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Providers</div>';
      html += '<div class="panel-badges">';
      for (var i = 0; i < node.providers.length; i++) html += '<span class="badge badge-provider">' + escHtml(node.providers[i]) + '</span>';
      html += '</div></div>';
    }

    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Source</div>';
    html += '<div class="panel-row"><span class="panel-row-label">Fichier</span><span style="font-family:monospace;font-size:11px">' + escHtml(node.sourceFile) + '</span></div>';
    html += '<div class="panel-row"><span class="panel-row-label">Ligne</span><span>' + node.sourceLine + '</span></div>';
    html += '</div>';

    sidePanel.innerHTML = html;
    sidePanel.hidden = false;

    document.getElementById('panelClose').addEventListener('click', function() {
      sidePanel.hidden = true;
      selectedId = null;
      applySelectionState(null);
    });
  }

  function selectNode(id) {
    selectedId = id;
    applySelectionState(id);
    var nodeMap = {};
    for (var i = 0; i < allNodes.length; i++) nodeMap[allNodes[i].id] = allNodes[i];
    renderSidePanel(id ? nodeMap[id] : null);
  }

  // --- Node click & drag ---
  (function setupNodeInteractions() {
    for (var id in cardEls) {
      (function(nodeId, el) {
        var mouseDownPos = null;
        var isDragging = false;
        var dragStart = null;
        var posStart = null;

        el.addEventListener('mousedown', function(e) {
          // Don't intercept clicks on interactive elements inside the panel label / body
          if (e.target.closest && e.target.closest('button,a,input')) return;
          e.stopPropagation();
          mouseDownPos = { x: e.clientX, y: e.clientY };
          isDragging = false;
          dragStart = { x: e.clientX, y: e.clientY };
          posStart = { x: positions[nodeId].x, y: positions[nodeId].y };

          function onMove(me) {
            var dx = me.clientX - dragStart.x;
            var dy = me.clientY - dragStart.y;
            if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
              isDragging = true;
              el.classList.add('dragging');
            }
            if (isDragging) {
              positions[nodeId].x = posStart.x + dx / canvasScale;
              positions[nodeId].y = posStart.y + dy / canvasScale;
              el.style.left = positions[nodeId].x + 'px';
              el.style.top = positions[nodeId].y + 'px';
              renderConnections();
              if (selectedId) applySelectionState(selectedId);
            }
          }

          function onUp(ue) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            el.classList.remove('dragging');
            if (!isDragging) {
              // It was a click
              if (selectedId === nodeId) {
                selectNode(null);
              } else {
                selectNode(nodeId);
              }
            }
          }

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      })(id, cardEls[id]);
    }
  })();

  // --- Pan ---
  (function setupPan() {
    var panStart = null;
    var panOffsetStart = null;

    viewport.addEventListener('mousedown', function(e) {
      if (e.target !== viewport && e.target !== world && e.target !== svg) return;
      panStart = { x: e.clientX, y: e.clientY };
      panOffsetStart = { x: canvasOffset.x, y: canvasOffset.y };
      viewport.classList.add('panning');

      function onMove(me) {
        var dx = me.clientX - panStart.x;
        var dy = me.clientY - panStart.y;
        canvasOffset.x = panOffsetStart.x + dx;
        canvasOffset.y = panOffsetStart.y + dy;
        applyTransform();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        viewport.classList.remove('panning');
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // --- Zoom (wheel) ---
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    var newScale = Math.min(2, Math.max(0.3, canvasScale * delta));

    // Zoom centered on mouse position
    var rect = viewport.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;

    canvasOffset.x = mouseX - (mouseX - canvasOffset.x) * (newScale / canvasScale);
    canvasOffset.y = mouseY - (mouseY - canvasOffset.y) * (newScale / canvasScale);
    canvasScale = newScale;
    applyTransform();
  }, { passive: false });

  function applyTransform() {
    var t = 'translate(' + canvasOffset.x + 'px,' + canvasOffset.y + 'px) scale(' + canvasScale + ')';
    world.style.transform = t;
    // Shift background dot pattern with pan (pattern lives on the viewport so it always fills the screen)
    viewport.style.backgroundPosition = canvasOffset.x + 'px ' + canvasOffset.y + 'px';
  }

  // --- Fit view ---
  document.getElementById('fit-view').addEventListener('click', function() {
    if (allNodes.length === 0) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var id in positions) {
      var p = positions[id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.width > maxX) maxX = p.x + p.width;
      if (p.y + p.height > maxY) maxY = p.y + p.height;
    }
    var padding = 60;
    var vw = viewport.offsetWidth;
    var vh = viewport.offsetHeight;
    var contentW = maxX - minX + padding * 2;
    var contentH = maxY - minY + padding * 2;
    var scale = Math.min(2, Math.max(0.3, Math.min(vw / contentW, vh / contentH)));
    canvasScale = scale;
    canvasOffset.x = (vw - contentW * scale) / 2 - (minX - padding) * scale;
    canvasOffset.y = (vh - contentH * scale) / 2 - (minY - padding) * scale;
    applyTransform();
  });

  // --- Search ---
  searchInput.addEventListener('input', function() {
    var q = searchInput.value.trim().toLowerCase();
    for (var i = 0; i < allNodes.length; i++) {
      var node = allNodes[i];
      var el = cardEls[node.id];
      if (!el) continue;
      if (!q) {
        el.classList.remove('dimmed');
        continue;
      }
      var text = [
        node.path, node.fullPath, node.component, node.redirectTo,
        node.loadComponent && node.loadComponent.source,
        node.loadChildren && node.loadChildren.source
      ].concat(node.canActivate || []).concat(node.canMatch || []).concat(node.canActivateChild || []).concat(node.canDeactivate || []).concat(node.canLoad || []).concat(node.resolve ? Object.keys(node.resolve) : []).concat(node.data ? Object.keys(node.data) : []).concat(node.providers || []).filter(Boolean).join(' ').toLowerCase();
      if (text.indexOf(q) === -1) {
        el.classList.add('dimmed');
      } else {
        el.classList.remove('dimmed');
      }
    }
  });

  // --- Export JSON ---
  document.getElementById('export-json').addEventListener('click', function() {
    var blob = new Blob([JSON.stringify(window.__GRAPH__, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'angular-routes.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Initial fit
  setTimeout(function() {
    document.getElementById('fit-view').click();
  }, 50);

})();
`;
}
