import { readFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import type { AngularProjectInfo, TsconfigPaths, WorkspaceProjectInfo } from "./types.js";
import {
  discoverWorkspace,
  isRecord,
  readJsonc,
  type DiscoveredWorkspace,
  type WorkspaceProject,
} from "./workspace-discovery.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveExtendsPath(entry: string, configDirectory: string): string | undefined {
  if (!entry.startsWith(".") && !isAbsolute(entry)) return undefined;
  const candidate = resolve(configDirectory, entry);
  return candidate.endsWith(".json") ? candidate : `${candidate}.json`;
}

async function parseTsconfigPaths(tsconfigPath: string): Promise<TsconfigPaths> {
  const visited = new Set<string>();

  async function walk(filePath: string): Promise<TsconfigPaths> {
    const absolutePath = resolve(filePath);
    if (visited.has(absolutePath)) return { baseUrl: "", paths: {} };
    visited.add(absolutePath);

    let raw: unknown;
    try {
      raw = await readJsonc(absolutePath);
    } catch {
      return { baseUrl: "", paths: {} };
    }
    if (!isRecord(raw)) return { baseUrl: "", paths: {} };

    const configDirectory = dirname(absolutePath);
    const extendsValue = raw["extends"];
    const extendsEntries = typeof extendsValue === "string"
      ? [extendsValue]
      : Array.isArray(extendsValue)
        ? extendsValue.filter((entry): entry is string => typeof entry === "string")
        : [];

    let inherited: TsconfigPaths = { baseUrl: "", paths: {} };
    for (const entry of extendsEntries) {
      const parentPath = resolveExtendsPath(entry, configDirectory);
      if (parentPath) inherited = await walk(parentPath);
    }

    const compilerOptions = raw["compilerOptions"];
    if (!isRecord(compilerOptions)) return inherited;

    const baseUrl = typeof compilerOptions["baseUrl"] === "string"
      ? resolve(configDirectory, compilerOptions["baseUrl"])
      : inherited.baseUrl;
    if (!("paths" in compilerOptions)) return { baseUrl, paths: inherited.paths };

    const rawPaths = compilerOptions["paths"];
    if (!isRecord(rawPaths)) return { baseUrl, paths: {} };
    const declarationBase = baseUrl || configDirectory;
    const paths: Record<string, string[]> = {};
    for (const [pattern, values] of Object.entries(rawPaths)) {
      if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) continue;
      paths[pattern] = values.map((value) =>
        isAbsolute(value) ? value : resolve(declarationBase, value)
      );
    }
    return { baseUrl, paths };
  }

  return walk(tsconfigPath);
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function availableApplications(workspace: DiscoveredWorkspace): WorkspaceProject[] {
  return [...workspace.projects.values()]
    .filter((project) => project.projectType === "application")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function applicationError(message: string, applications: WorkspaceProject[]): Error {
  const names = applications.map((project) => project.name).join(", ") || "none";
  return new Error(`${message}. Available applications: ${names}`);
}

function selectApplication(
  workspace: DiscoveredWorkspace,
  targetAbs: string,
  projectName?: string
): WorkspaceProject {
  const applications = availableApplications(workspace);

  if (projectName) {
    const requested = workspace.projects.get(projectName);
    if (!requested) throw applicationError(`Project '${projectName}' not found`, applications);
    if (requested.projectType !== "application") {
      throw applicationError(`Project '${projectName}' is not an application`, applications);
    }
    return requested;
  }

  const containing = applications
    .filter((project) => project.root !== workspace.workspaceRoot && isWithin(project.root, targetAbs))
    .sort((a, b) => b.root.length - a.root.length);
  if (containing.length > 0) return containing[0];

  if (workspace.defaultProject) {
    const defaultProject = workspace.projects.get(workspace.defaultProject);
    if (defaultProject?.projectType === "application") return defaultProject;
  }
  if (applications.length === 1) return applications[0];
  if (applications.length === 0 && workspace.kind === "standalone") {
    const fallback = workspace.projects.get("app");
    if (fallback) return fallback;
  }
  throw applicationError("Multiple Angular applications found; use --project", applications);
}

async function resolveTsconfigPath(
  workspaceRoot: string,
  project: WorkspaceProject
): Promise<string> {
  const candidates: string[] = [];
  if (project.tsConfig) {
    candidates.push(resolve(workspaceRoot, project.tsConfig));
    candidates.push(resolve(project.root, project.tsConfig));
  }
  candidates.push(
    join(project.root, "tsconfig.app.json"),
    join(project.root, "tsconfig.json"),
    join(workspaceRoot, "tsconfig.base.json"),
    join(workspaceRoot, "tsconfig.json")
  );
  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) return candidate;
  }
  return candidates[0];
}

async function readAngularVersion(workspaceRoot: string): Promise<string | undefined> {
  try {
    const raw = await readJsonc(join(workspaceRoot, "package.json"));
    if (!isRecord(raw)) return undefined;
    for (const field of ["dependencies", "devDependencies"]) {
      const dependencies = raw[field];
      if (!isRecord(dependencies)) continue;
      const version = dependencies["@angular/core"];
      if (typeof version === "string") return version;
    }
  } catch {
    // A package file is optional for static route analysis.
  }
  return undefined;
}

function toProjectInfo(project: WorkspaceProject): WorkspaceProjectInfo {
  return {
    name: project.name,
    projectType: project.projectType,
    root: project.root,
    sourceRoot: project.sourceRoot,
    configPath: project.configPath,
    tsConfig: project.tsConfig,
    packageName: project.packageName,
  };
}

export async function resolveAngularProject(
  targetAbs: string,
  projectName?: string
): Promise<AngularProjectInfo> {
  const absoluteTarget = resolve(targetAbs);
  const workspace = await discoverWorkspace(absoluteTarget);
  const project = selectApplication(workspace, absoluteTarget, projectName);
  const tsconfigPath = await resolveTsconfigPath(workspace.workspaceRoot, project);
  const tsconfigPaths = await parseTsconfigPaths(tsconfigPath);

  return {
    workspaceRoot: workspace.workspaceRoot,
    projectRoot: project.root,
    projectName: project.name,
    sourceRoot: project.sourceRoot,
    tsconfigPath,
    angularJsonPath: workspace.kind === "angular" ? workspace.configPath : undefined,
    tsconfigPaths,
    workspaceProjects: [...workspace.projects.values()].map(toProjectInfo),
    angularVersion: await readAngularVersion(workspace.workspaceRoot),
  };
}
