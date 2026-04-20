import * as p from "@clack/prompts";
import { resolve, join, isAbsolute } from "path";
import { mkdir, writeFile } from "fs/promises";
import { parseCliArgs } from "./cli/args";
import { printHelp, showHeader, c } from "./cli/display";
import { resolveAngularProject } from "./analyzer/project-resolver";
import { findRouteEntry } from "./analyzer/route-finder";
import { buildRouteGraph } from "./analyzer/route-parser";
import { renderViewerHtml } from "./generator/html-builder";
import type { RouteGraph, RouteNode } from "./analyzer/types";

const VERSION = "0.1.0";

export async function run(): Promise<void> {
  const opts = parseCliArgs();

  if (opts.help) {
    printHelp(VERSION);
    return;
  }

  const targetAbs = isAbsolute(opts.targetPath)
    ? opts.targetPath
    : resolve(process.cwd(), opts.targetPath);

  if (!opts.json) {
    showHeader(VERSION);
    p.intro(`${c.dim}Scanning${c.reset} ${c.cyan}${targetAbs}${c.reset}`);
  }

  const projectInfo = await (async () => {
    const spin = opts.json ? null : p.spinner();
    spin?.start("Detecting Angular project...");
    try {
      const info = await resolveAngularProject(targetAbs, opts.project);
      spin?.stop(`Project detected: ${c.cyan}${info.projectName}${c.reset}`);
      return info;
    } catch (e) {
      spin?.stop("Project detection failed");
      throw e;
    }
  })();

  const entryFile = opts.entry
    ? resolve(targetAbs, opts.entry)
    : await findRouteEntry(projectInfo);

  if (opts.verbose && !opts.json) {
    p.log.info(`Entry: ${c.dim}${entryFile}${c.reset}`);
  }

  const graph = await (async () => {
    const spin = opts.json ? null : p.spinner();
    spin?.start("Analyzing routes...");
    try {
      const g = await buildRouteGraph(entryFile, projectInfo);
      spin?.stop(`Analysis complete (${countRoutes(g)} routes)`);
      return g;
    } catch (e) {
      spin?.stop("Analysis failed");
      throw e;
    }
  })();

  if (opts.json) {
    process.stdout.write(JSON.stringify(graph, null, 2));
    return;
  }

  printSummary(graph);

  const outDir = opts.output
    ? isAbsolute(opts.output)
      ? opts.output
      : resolve(targetAbs, opts.output)
    : join(targetAbs, "angular-routing");

  const spin = p.spinner();
  spin.start("Generating HTML graph...");
  await mkdir(outDir, { recursive: true });
  const html = renderViewerHtml(graph);
  await writeFile(join(outDir, "index.html"), html, "utf-8");
  await writeFile(
    join(outDir, "data.json"),
    JSON.stringify(graph, null, 2),
    "utf-8"
  );
  spin.stop(`Graph generated: ${c.cyan}${outDir}${c.reset}`);

  if (opts.verbose) {
    printWarnings(graph);
  } else if (graph.warnings.length > 0) {
    p.log.warn(`${graph.warnings.length} warning(s) - rerun with --verbose`);
  }

  const indexPath = join(outDir, "index.html");
  p.outro(`${c.green}Open:${c.reset} open "${indexPath}"`);

  if (opts.open) {
    await openInBrowser(indexPath);
  }
}

function countRoutes(graph: RouteGraph): number {
  let count = 0;
  const walk = (nodes: RouteNode[]): void => {
    for (const n of nodes) {
      count++;
      walk(n.children);
    }
  };
  walk(graph.roots);
  return count;
}

function printSummary(graph: RouteGraph): void {
  const counts: Record<string, number> = {};
  const walk = (nodes: RouteNode[]): void => {
    for (const n of nodes) {
      counts[n.type] = (counts[n.type] ?? 0) + 1;
      walk(n.children);
    }
  };
  walk(graph.roots);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  p.log.success(`${c.bold}${total}${c.reset} routes analyzed`);

  const breakdown = Object.entries(counts)
    .map(([t, n]) => `${c.dim}${t}:${c.reset} ${c.cyan}${n}${c.reset}`)
    .join("  ");
  p.log.message(`  ${breakdown}`);
}

function printWarnings(graph: RouteGraph): void {
  if (graph.warnings.length === 0) return;
  p.log.warn(`${graph.warnings.length} warning(s):`);
  for (const w of graph.warnings) {
    const loc = w.file ? ` ${c.dim}(${w.file}${w.line ? ":" + w.line : ""})${c.reset}` : "";
    p.log.message(`  ${c.yellow}!${c.reset} ${w.message}${loc}`);
  }
}

async function openInBrowser(path: string): Promise<void> {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  try {
    Bun.spawn([cmd, path], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // ignore
  }
}
