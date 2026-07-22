import { readFile, readdir } from "fs/promises";
import { basename, dirname, join, relative, resolve } from "path";
import type { WorkspaceProjectInfo } from "./types.js";

export interface WorkspaceProject extends WorkspaceProjectInfo {}

export interface DiscoveredWorkspace {
  workspaceRoot: string;
  configPath?: string;
  kind: "angular" | "nx" | "standalone";
  defaultProject?: string;
  projects: Map<string, WorkspaceProject>;
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".nx",
  "angular-routing",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
]);

export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        out += text[i] + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }

  return out.replace(/,(\s*[}\]])/g, "$1");
}

export async function readJsonc(filePath: string): Promise<unknown> {
  return JSON.parse(stripJsonc(await readFile(filePath, "utf-8")));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceConfig(
  startPath: string
): Promise<{ kind: "angular" | "nx"; path: string } | undefined> {
  let current = resolve(startPath);
  for (;;) {
    const angularPath = join(current, "angular.json");
    if (await fileExists(angularPath)) return { kind: "angular", path: angularPath };
    const nxPath = join(current, "nx.json");
    if (await fileExists(nxPath)) return { kind: "nx", path: nxPath };
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function inferProjectType(
  explicit: unknown,
  root: string,
  targets: unknown
): WorkspaceProject["projectType"] {
  if (explicit === "application" || explicit === "library") return explicit;
  if (isRecord(targets)) {
    for (const target of Object.values(targets)) {
      if (!isRecord(target)) continue;
      const executor = target["executor"];
      if (typeof executor !== "string") continue;
      if (/(application|browser|dev-server|serve)/i.test(executor)) return "application";
      if (/(library|package|ng-packagr)/i.test(executor)) return "library";
    }
  }
  const portableRoot = root.replace(/\\/g, "/");
  if (portableRoot === "apps" || portableRoot.startsWith("apps/")) return "application";
  if (portableRoot === "libs" || portableRoot.startsWith("libs/")) return "library";
  return "unknown";
}

function readTsConfig(targets: unknown): string | undefined {
  if (!isRecord(targets)) return undefined;
  const build = targets["build"];
  if (!isRecord(build)) return undefined;
  const options = build["options"];
  if (!isRecord(options)) return undefined;
  return typeof options["tsConfig"] === "string" ? options["tsConfig"] : undefined;
}

function normalizeProject(
  workspaceRoot: string,
  configPath: string,
  raw: Record<string, unknown>,
  fallbackName: string,
  packageName?: string
): WorkspaceProject {
  const rawRoot = typeof raw["root"] === "string"
    ? raw["root"]
    : relative(workspaceRoot, dirname(configPath));
  const root = resolve(workspaceRoot, rawRoot || ".");
  const sourceRoot = resolve(
    workspaceRoot,
    typeof raw["sourceRoot"] === "string"
      ? raw["sourceRoot"]
      : join(rawRoot || ".", "src")
  );
  const targets = isRecord(raw["targets"])
    ? raw["targets"]
    : isRecord(raw["architect"])
      ? raw["architect"]
      : undefined;
  const name = typeof raw["name"] === "string" ? raw["name"] : fallbackName;

  return {
    name,
    projectType: inferProjectType(raw["projectType"], rawRoot, targets),
    root,
    sourceRoot,
    configPath,
    tsConfig: readTsConfig(targets),
    packageName,
  };
}

async function discoverAngularWorkspace(configPath: string): Promise<DiscoveredWorkspace> {
  const workspaceRoot = dirname(configPath);
  const raw = await readJsonc(configPath);
  if (!isRecord(raw)) throw new Error("angular.json is not a valid object");
  const rawProjects = raw["projects"];
  if (!isRecord(rawProjects)) throw new Error("angular.json has no 'projects' field");

  const projects = new Map<string, WorkspaceProject>();
  for (const [fallbackName, projectRaw] of Object.entries(rawProjects)) {
    if (!isRecord(projectRaw)) continue;
    const project = normalizeProject(workspaceRoot, configPath, projectRaw, fallbackName);
    projects.set(project.name, project);
  }

  return {
    workspaceRoot,
    configPath,
    kind: "angular",
    defaultProject: typeof raw["defaultProject"] === "string" ? raw["defaultProject"] : undefined,
    projects,
  };
}

async function collectNxProjectConfigs(workspaceRoot: string): Promise<string[]> {
  const configs: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(join(directory, entry.name));
      } else if (entry.isFile() && (entry.name === "project.json" || entry.name === "package.json")) {
        configs.push(join(directory, entry.name));
      }
    }
  }

  await walk(workspaceRoot);
  return configs.sort();
}

async function discoverNxWorkspace(configPath: string): Promise<DiscoveredWorkspace> {
  const workspaceRoot = dirname(configPath);
  const projects = new Map<string, WorkspaceProject>();
  const rootsWithProjectJson = new Set<string>();
  const configFiles = await collectNxProjectConfigs(workspaceRoot);

  for (const candidate of configFiles.filter((path) => basename(path) === "project.json")) {
    const raw = await readJsonc(candidate).catch(() => undefined);
    if (!isRecord(raw)) continue;
    const project = normalizeProject(workspaceRoot, candidate, raw, basename(dirname(candidate)));
    projects.set(project.name, project);
    rootsWithProjectJson.add(project.root);
  }

  for (const candidate of configFiles.filter((path) => basename(path) === "package.json")) {
    const rawPackage = await readJsonc(candidate).catch(() => undefined);
    if (!isRecord(rawPackage) || !isRecord(rawPackage["nx"])) continue;
    const nx = { ...rawPackage["nx"] } as Record<string, unknown>;
    if (typeof nx["name"] !== "string" && typeof rawPackage["name"] === "string") {
      nx["name"] = rawPackage["name"];
    }
    const project = normalizeProject(
      workspaceRoot,
      candidate,
      nx,
      typeof rawPackage["name"] === "string" ? rawPackage["name"] : basename(dirname(candidate)),
      typeof rawPackage["name"] === "string" ? rawPackage["name"] : undefined
    );
    if (rootsWithProjectJson.has(project.root)) continue;
    projects.set(project.name, project);
  }

  return { workspaceRoot, configPath, kind: "nx", projects };
}

export async function discoverWorkspace(startPath: string): Promise<DiscoveredWorkspace> {
  const config = await findWorkspaceConfig(startPath);
  if (config?.kind === "angular") return discoverAngularWorkspace(config.path);
  if (config?.kind === "nx") return discoverNxWorkspace(config.path);

  const workspaceRoot = resolve(startPath);
  const project: WorkspaceProject = {
    name: "app",
    projectType: "application",
    root: workspaceRoot,
    sourceRoot: join(workspaceRoot, "src"),
    configPath: join(workspaceRoot, "package.json"),
  };
  return {
    workspaceRoot,
    kind: "standalone",
    projects: new Map([[project.name, project]]),
  };
}
