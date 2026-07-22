import { readFile } from "fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "path";
import {
  Project,
  SyntaxKind,
  type Expression,
  type Node,
  type SourceFile,
} from "ts-morph";
import type { AngularProjectInfo, Warning } from "./types.js";

export interface ResolvedRouteSource {
  filePath: string;
  exportName?: string;
}

export interface RouteSourceRequest {
  specifier: string;
  fromFile: string;
  exportName?: string;
}

export interface LazyRouteImport {
  specifier: string;
  exportName: string;
  node: Node;
}

export interface RouteSourceResolver {
  warnings: Warning[];
  resolveImport(specifier: string, fromFile: string): Promise<string | undefined>;
  resolveSource(request: RouteSourceRequest): Promise<ResolvedRouteSource | undefined>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCandidate(candidate: string): Promise<string | undefined> {
  const extensions = /\.(?:[cm]?ts|tsx)$/.test(extname(candidate))
    ? [""]
    : ["", ".ts", ".routes.ts", "/index.ts"];
  for (const extension of extensions) {
    const filePath = `${candidate}${extension}`;
    if (await fileExists(filePath)) return resolve(filePath);
  }
  return undefined;
}

function matchPathPattern(pattern: string, specifier: string): string | undefined {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) return pattern === specifier ? "" : undefined;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function pathPatternSpecificity(pattern: string): number {
  return pattern.replace("*", "").length + (pattern.includes("*") ? 0 : 10_000);
}

export async function resolveImportSpecifier(
  specifier: string,
  fromFile: string,
  info: AngularProjectInfo
): Promise<string | undefined> {
  const pathEntries = Object.entries(info.tsconfigPaths.paths)
    .sort(([left], [right]) => pathPatternSpecificity(right) - pathPatternSpecificity(left));
  for (const [pattern, targets] of pathEntries) {
    const capture = matchPathPattern(pattern, specifier);
    if (capture === undefined) continue;
    for (const target of targets) {
      const candidate = target.includes("*") ? target.replace("*", capture) : target;
      const resolved = await resolveCandidate(candidate);
      if (resolved) return resolved;
    }
  }

  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return resolveCandidate(
      isAbsolute(specifier) ? specifier : resolve(dirname(fromFile), specifier)
    );
  }

  const workspaceProject = info.workspaceProjects.find(
    (project) => project.packageName === specifier
  );
  if (workspaceProject) {
    const entry = await resolveCandidate(join(workspaceProject.sourceRoot, "index"));
    if (entry) return entry;
  }

  if (info.tsconfigPaths.baseUrl) {
    const baseUrlPath = await resolveCandidate(join(info.tsconfigPaths.baseUrl, specifier));
    if (baseUrlPath) return baseUrlPath;
  }
  return undefined;
}

function localDeclarationExists(sourceFile: SourceFile, exportName: string): boolean {
  if (exportName === "default") {
    return (
      sourceFile.getExportAssignments().some((assignment) => !assignment.isExportEquals()) ||
      sourceFile.getClasses().some((declaration) => declaration.isDefaultExport()) ||
      sourceFile.getFunctions().some((declaration) => declaration.isDefaultExport())
    );
  }
  const variable = sourceFile.getVariableDeclaration(exportName);
  if (variable?.getVariableStatement()?.isExported()) return true;
  return [
    sourceFile.getClass(exportName),
    sourceFile.getFunction(exportName),
    sourceFile.getInterface(exportName),
    sourceFile.getTypeAlias(exportName),
  ].some((declaration) => declaration?.isExported());
}

function namedExportTarget(
  sourceFile: SourceFile,
  requestedName: string
): { specifier: string; exportName: string }[] {
  const matches: { specifier: string; exportName: string }[] = [];
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier) continue;
    for (const named of declaration.getNamedExports()) {
      const exportedName = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
      if (exportedName !== requestedName) continue;
      matches.push({ specifier, exportName: named.getNameNode().getText() });
    }
  }
  return matches;
}

function starExportTargets(sourceFile: SourceFile): string[] {
  return sourceFile.getExportDeclarations()
    .filter((declaration) => declaration.getNamedExports().length === 0)
    .map((declaration) => declaration.getModuleSpecifierValue())
    .filter((specifier): specifier is string => Boolean(specifier));
}

function sourceLine(node: Node | undefined): number | undefined {
  return node?.getStartLineNumber();
}

export function createRouteSourceResolver(
  info: AngularProjectInfo,
  project = new Project({
    tsConfigFilePath: info.tsconfigPath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, noEmit: true, skipLibCheck: true },
  })
): RouteSourceResolver {
  const warnings: Warning[] = [];
  const importCache = new Map<string, string | undefined>();

  async function resolveImport(specifier: string, fromFile: string): Promise<string | undefined> {
    const key = `${resolve(fromFile)}\0${specifier}`;
    if (importCache.has(key)) return importCache.get(key);
    const resolvedPath = await resolveImportSpecifier(specifier, fromFile, info);
    importCache.set(key, resolvedPath);
    return resolvedPath;
  }

  async function followExport(
    source: ResolvedRouteSource,
    stack: Set<string>
  ): Promise<ResolvedRouteSource | undefined> {
    const exportName = source.exportName ?? "default";
    const key = `${source.filePath}#${exportName}`;
    if (stack.has(key)) {
      warnings.push({
        level: "warn",
        message: `Barrel export cycle detected while resolving '${exportName}'`,
        file: source.filePath,
      });
      return undefined;
    }
    const nextStack = new Set(stack).add(key);
    const sourceFile = project.addSourceFileAtPathIfExists(source.filePath);
    if (!sourceFile) return undefined;

    if (localDeclarationExists(sourceFile, exportName)) {
      return { filePath: source.filePath, exportName };
    }

    for (const target of namedExportTarget(sourceFile, exportName)) {
      const targetFile = await resolveImport(target.specifier, source.filePath);
      if (!targetFile) continue;
      const resolvedSource = await followExport(
        { filePath: targetFile, exportName: target.exportName },
        nextStack
      );
      if (resolvedSource) return resolvedSource;
    }

    for (const specifier of starExportTargets(sourceFile)) {
      const targetFile = await resolveImport(specifier, source.filePath);
      if (!targetFile) continue;
      const resolvedSource = await followExport(
        { filePath: targetFile, exportName },
        nextStack
      );
      if (resolvedSource) return resolvedSource;
    }

    return undefined;
  }

  async function resolveSource(request: RouteSourceRequest): Promise<ResolvedRouteSource | undefined> {
    const filePath = await resolveImport(request.specifier, request.fromFile);
    if (!filePath) {
      warnings.push({
        level: "warn",
        message: `Unable to resolve route import '${request.specifier}'`,
        file: request.fromFile,
      });
      return undefined;
    }
    const exportName = request.exportName ?? "default";
    const warningCount = warnings.length;
    const resolvedSource = await followExport({ filePath, exportName }, new Set());
    if (resolvedSource) return resolvedSource;
    if (warnings.length > warningCount) return undefined;
    warnings.push({
      level: "warn",
      message: `Unable to resolve export '${exportName}' from '${request.specifier}'`,
      file: request.fromFile,
    });
    return undefined;
  }

  return { warnings, resolveImport, resolveSource };
}

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    current.isKind(SyntaxKind.ParenthesizedExpression) ||
    current.isKind(SyntaxKind.AsExpression) ||
    current.isKind(SyntaxKind.SatisfiesExpression)
  ) {
    current = current.isKind(SyntaxKind.ParenthesizedExpression)
      ? current.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression()
      : current.isKind(SyntaxKind.AsExpression)
        ? current.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
        : current.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression();
  }
  return current;
}

function returnedExpression(node: Node): Node {
  if (!node.isKind(SyntaxKind.Block)) return node;
  for (const statement of node.asKindOrThrow(SyntaxKind.Block).getStatements()) {
    if (!statement.isKind(SyntaxKind.ReturnStatement)) continue;
    return statement.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression() ?? node;
  }
  return node;
}

function readImportCall(node: Node): { specifier: string; node: Node } | undefined {
  const current = unwrapExpression(node);
  if (!current.isKind(SyntaxKind.CallExpression)) return undefined;
  const call = current.asKindOrThrow(SyntaxKind.CallExpression);
  if (!call.getExpression().isKind(SyntaxKind.ImportKeyword)) return undefined;
  const argument = call.getArguments()[0];
  if (!argument?.isKind(SyntaxKind.StringLiteral)) return undefined;
  return {
    specifier: argument.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText(),
    node: call,
  };
}

function selectedThenExport(call: Node): string | undefined {
  if (!call.isKind(SyntaxKind.CallExpression)) return undefined;
  const callback = call.asKindOrThrow(SyntaxKind.CallExpression).getArguments()[0];
  if (!callback?.isKind(SyntaxKind.ArrowFunction)) return undefined;
  const arrow = callback.asKindOrThrow(SyntaxKind.ArrowFunction);
  const parameter = arrow.getParameters()[0]?.getName();
  const body = unwrapExpression(returnedExpression(arrow.getBody()));
  if (!parameter || !body.isKind(SyntaxKind.PropertyAccessExpression)) return undefined;
  const property = body.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  return property.getExpression().getText() === parameter ? property.getName() : undefined;
}

export function extractLazyRouteImport(expression: Expression): LazyRouteImport | undefined {
  let body: Node = expression;
  if (body.isKind(SyntaxKind.ArrowFunction)) {
    body = returnedExpression(body.asKindOrThrow(SyntaxKind.ArrowFunction).getBody());
  }
  body = unwrapExpression(body);

  const direct = readImportCall(body);
  if (direct) return { ...direct, exportName: "default" };
  if (!body.isKind(SyntaxKind.CallExpression)) return undefined;
  const call = body.asKindOrThrow(SyntaxKind.CallExpression);
  const callee = call.getExpression();
  if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) return undefined;
  const propertyAccess = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  if (propertyAccess.getName() !== "then") return undefined;
  const imported = readImportCall(propertyAccess.getExpression());
  if (!imported) return undefined;
  return {
    ...imported,
    exportName: selectedThenExport(call) ?? "default",
  };
}

export function warningLine(node: Node | undefined): number | undefined {
  return sourceLine(node);
}
