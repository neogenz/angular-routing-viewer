import { readFile } from "fs/promises";
import { resolve, dirname, join } from "path";
import type { AngularProjectInfo, TsconfigPaths } from "./types.js";

// Strip JSONC using a state machine — handles // and /* */ inside strings correctly
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\") {
        // Escape: copy both chars verbatim
        out += text[i] + text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch;
      i++;
      continue;
    }

    // Not in string
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    // Block comment
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i += 2; // skip */
      continue;
    }

    // Line comment
    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, "$1");
}

async function readJsonc(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf-8");
  return JSON.parse(stripJsonc(text));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function parseTsconfigPaths(
  tsconfigPath: string
): Promise<TsconfigPaths> {
  let baseUrl = "";
  let paths: Record<string, string[]> = {};

  const visited = new Set<string>();

  // Returns the effective baseUrl from this tsconfig (used for resolving its own paths)
  async function walk(filePath: string): Promise<string> {
    const abs = resolve(filePath);
    if (visited.has(abs)) return baseUrl;
    visited.add(abs);

    let raw: unknown;
    try {
      raw = await readJsonc(abs);
    } catch {
      return baseUrl;
    }

    if (!isRecord(raw)) return baseUrl;
    const dir = dirname(abs);

    // Resolve extends first (so child values override parent).
    // `extends` can be a string or an array of strings (TS 5.0+).
    const extendsVal = raw["extends"];
    const extendsList =
      typeof extendsVal === "string"
        ? [extendsVal]
        : Array.isArray(extendsVal)
          ? extendsVal.filter((e): e is string => typeof e === "string")
          : [];
    for (const entry of extendsList) {
      const parentPath = resolve(dir, entry);
      const parent = parentPath.endsWith(".json")
        ? parentPath
        : parentPath + ".json";
      await walk(parent);
    }

    const compilerOptions = raw["compilerOptions"];
    if (!isRecord(compilerOptions)) return baseUrl;

    // Child overrides parent — apply on top
    if (typeof compilerOptions["baseUrl"] === "string") {
      baseUrl = resolve(dir, compilerOptions["baseUrl"]);
    }

    // Paths are resolved relative to baseUrl (TS spec), not the tsconfig dir
    // Use the current effective baseUrl for this tsconfig's paths
    const effectiveBaseUrl = typeof compilerOptions["baseUrl"] === "string"
      ? resolve(dir, compilerOptions["baseUrl"])
      : baseUrl;

    const rawPaths = compilerOptions["paths"];
    if (isRecord(rawPaths)) {
      for (const [key, val] of Object.entries(rawPaths)) {
        if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
          // Resolve each path entry relative to baseUrl
          paths[key] = (val as string[]).map((p) => {
            // Absolute or rooted paths stay as-is
            if (p.startsWith("/")) return p;
            return resolve(effectiveBaseUrl || dir, p);
          });
        }
      }
    }

    return effectiveBaseUrl;
  }

  await walk(tsconfigPath);
  return { baseUrl, paths };
}

async function findAngularJson(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "angular.json");
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // not found, go up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readAngularVersion(
  projectRoot: string
): Promise<string | undefined> {
  const pkgPath = join(projectRoot, "package.json");
  try {
    const raw = await readJsonc(pkgPath);
    if (!isRecord(raw)) return undefined;
    const deps = raw["dependencies"];
    if (!isRecord(deps)) return undefined;
    const ver = deps["@angular/core"];
    return typeof ver === "string" ? ver : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveAngularProject(
  targetAbs: string,
  projectName?: string
): Promise<AngularProjectInfo> {
  const angularJsonPath = await findAngularJson(targetAbs);

  if (!angularJsonPath) {
    // Fallback: treat targetAbs as project root
    const projectRoot = targetAbs;
    const sourceRoot = join(projectRoot, "src");
    const tsconfigPath = join(projectRoot, "tsconfig.json");
    const tsconfigPaths = await parseTsconfigPaths(tsconfigPath);
    const angularVersion = await readAngularVersion(projectRoot);

    return {
      projectRoot,
      projectName: "app",
      sourceRoot,
      tsconfigPaths,
      angularVersion,
    };
  }

  const angularJsonDir = dirname(angularJsonPath);
  const raw = await readJsonc(angularJsonPath);

  if (!isRecord(raw)) {
    throw new Error("angular.json is not a valid object");
  }

  const projects = raw["projects"];
  if (!isRecord(projects)) {
    throw new Error("angular.json has no 'projects' field");
  }

  // Determine which project to use
  let chosenName: string;
  if (projectName && projectName in projects) {
    chosenName = projectName;
  } else if (typeof raw["defaultProject"] === "string") {
    chosenName = raw["defaultProject"];
  } else {
    chosenName = Object.keys(projects)[0];
  }

  const proj = projects[chosenName];
  if (!isRecord(proj)) {
    throw new Error(`Project '${chosenName}' not found in angular.json`);
  }

  const projectRoot = resolve(
    angularJsonDir,
    typeof proj["root"] === "string" ? proj["root"] : ""
  );
  const sourceRoot = resolve(
    angularJsonDir,
    typeof proj["sourceRoot"] === "string" ? proj["sourceRoot"] : "src"
  );

  // Find tsConfig from architect.build.options.tsConfig
  let tsconfigPath: string;
  const architect = proj["architect"];
  const build = isRecord(architect) ? architect["build"] : undefined;
  const buildOptsRaw = isRecord(build) ? build["options"] : undefined;
  const tsConfigRaw = isRecord(buildOptsRaw) ? buildOptsRaw["tsConfig"] : undefined;

  if (typeof tsConfigRaw === "string") {
    tsconfigPath = resolve(angularJsonDir, tsConfigRaw);
  } else {
    // Fallback to tsconfig.json at project root or workspace root
    const candidates = [
      join(projectRoot, "tsconfig.app.json"),
      join(projectRoot, "tsconfig.json"),
      join(angularJsonDir, "tsconfig.json"),
    ];
    tsconfigPath = candidates[0];
    for (const c of candidates) {
      try {
        await readFile(c);
        tsconfigPath = c;
        break;
      } catch {
        // continue
      }
    }
  }

  const tsconfigPaths = await parseTsconfigPaths(tsconfigPath);
  const angularVersion = await readAngularVersion(angularJsonDir);

  return {
    projectRoot,
    projectName: chosenName,
    sourceRoot,
    angularJsonPath,
    tsconfigPaths,
    angularVersion,
  };
}
