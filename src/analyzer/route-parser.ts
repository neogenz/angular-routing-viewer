import {
  Project,
  SyntaxKind,
  type SourceFile,
  type ObjectLiteralExpression,
  type ArrayLiteralExpression,
  type Expression,
  type Node,
} from "ts-morph";
import { createHash } from "crypto";
import { resolve } from "path";
import {
  createRouteSourceResolver,
  extractLazyRouteImport,
  type RouteSourceResolver,
} from "./route-source-resolver.js";
import type {
  RouteNode,
  RouteGraph,
  RouteType,
  Warning,
  TitleRef,
  LazyRef,
  AngularProjectInfo,
} from "./types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeId(sourceFile: string, line: number, path: string): string {
  return createHash("sha1")
    .update(`${sourceFile}:${line}:${path}`)
    .digest("hex")
    .slice(0, 12);
}

function normalizePath(fullPath: string): string {
  return ("/" + fullPath).replace(/\/+/g, "/");
}

interface ResolveCtx {
  project: Project;
  info: AngularProjectInfo;
  resolver: RouteSourceResolver;
  sourceFile: SourceFile;
}

// Find the imported module specifier for a top-level identifier name in a source file.
function findImportSpecifier(sf: SourceFile, identName: string): string | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const defaultImport = imp.getDefaultImport();
    if (defaultImport?.getText() === identName) return imp.getModuleSpecifierValue();
    for (const named of imp.getNamedImports()) {
      const localName = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
      if (localName === identName) return imp.getModuleSpecifierValue();
    }
    const ns = imp.getNamespaceImport();
    if (ns?.getText() === identName) return imp.getModuleSpecifierValue();
  }
  return undefined;
}

// Look up an exported const's object literal from a source file.
function findExportedObjectLiteral(sf: SourceFile, name: string): ObjectLiteralExpression | undefined {
  const decl = sf.getVariableDeclaration(name);
  if (!decl) return undefined;
  let init = decl.getInitializer();
  if (!init) return undefined;
  if (init.isKind(SyntaxKind.AsExpression)) {
    init = init.asKindOrThrow(SyntaxKind.AsExpression).getExpression();
  }
  if (init.isKind(SyntaxKind.SatisfiesExpression)) {
    init = init.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression();
  }
  if (init.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  }
  return undefined;
}

function findExportedStringLiteral(sf: SourceFile, name: string): string | undefined {
  const decl = sf.getVariableDeclaration(name);
  if (!decl) return undefined;
  const init = decl.getInitializer();
  if (!init) return undefined;
  if (init.isKind(SyntaxKind.StringLiteral)) {
    return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  return undefined;
}

// Try to resolve an expression to a string literal value by following imports/declarations.
// Handles: 'str', ident (const X = ...), OBJ.KEY (imported const object).
async function resolveToStringLiteral(expr: Node, ctx: ResolveCtx): Promise<string | undefined> {
  if (expr.isKind(SyntaxKind.StringLiteral)) {
    return expr.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  if (expr.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expr.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText();
  }

  // Identifier: look up in current file, then follow import
  if (expr.isKind(SyntaxKind.Identifier)) {
    const name = expr.asKindOrThrow(SyntaxKind.Identifier).getText();
    const local = findExportedStringLiteral(ctx.sourceFile, name);
    if (local !== undefined) return local;
    const specifier = findImportSpecifier(ctx.sourceFile, name);
    if (specifier) {
      const targetFile = await ctx.resolver.resolveImport(
        specifier,
        ctx.sourceFile.getFilePath()
      );
      if (targetFile) {
        const targetSf = ctx.project.addSourceFileAtPathIfExists(targetFile) ?? undefined;
        if (targetSf) {
          const val = findExportedStringLiteral(targetSf, name);
          if (val !== undefined) return val;
        }
      }
    }
    return undefined;
  }

  // Property access: OBJ.KEY
  if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const objExpr = pa.getExpression();
    const keyName = pa.getName();
    if (!objExpr.isKind(SyntaxKind.Identifier)) return undefined;
    const objName = objExpr.asKindOrThrow(SyntaxKind.Identifier).getText();

    // Try local first
    const localObj = findExportedObjectLiteral(ctx.sourceFile, objName);
    if (localObj) {
      const val = readObjectKey(localObj, keyName);
      if (val !== undefined) return val;
    }

    // Follow import
    const specifier = findImportSpecifier(ctx.sourceFile, objName);
    if (!specifier) return undefined;
    const targetFile = await ctx.resolver.resolveImport(
      specifier,
      ctx.sourceFile.getFilePath()
    );
    if (!targetFile) return undefined;
    const targetSf = ctx.project.addSourceFileAtPathIfExists(targetFile) ?? undefined;
    if (!targetSf) return undefined;

    // Handle barrel: re-export from another file
    for (const reExport of targetSf.getExportDeclarations()) {
      const mod = reExport.getModuleSpecifierValue();
      if (!mod) continue;
      const named = reExport.getNamedExports();
      const matches = named.length === 0 || named.some((n) => {
        const alias = n.getAliasNode()?.getText();
        const exportedName = n.getNameNode().getText();
        return alias === objName || exportedName === objName;
      });
      if (matches) {
        const reTarget = await ctx.resolver.resolveImport(
          mod,
          targetSf.getFilePath()
        );
        if (reTarget) {
          const reSf = ctx.project.addSourceFileAtPathIfExists(reTarget) ?? undefined;
          if (reSf) {
            const obj = findExportedObjectLiteral(reSf, objName);
            if (obj) {
              const val = readObjectKey(obj, keyName);
              if (val !== undefined) return val;
            }
          }
        }
      }
    }

    const obj = findExportedObjectLiteral(targetSf, objName);
    if (obj) return readObjectKey(obj, keyName);
    return undefined;
  }

  return undefined;
}

function readObjectKey(obj: ObjectLiteralExpression, key: string): string | undefined {
  for (const p of obj.getProperties()) {
    if (!p.isKind(SyntaxKind.PropertyAssignment)) continue;
    const pa = p.asKindOrThrow(SyntaxKind.PropertyAssignment);
    if (pa.getName() === key) {
      const val = pa.getInitializer();
      if (!val) return undefined;
      if (val.isKind(SyntaxKind.StringLiteral)) {
        return val.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
      }
      if (val.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return val.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText();
      }
      return undefined;
    }
  }
  return undefined;
}

// Parse a string prop value (with optional constant resolution context)
async function getPropString(
  obj: ObjectLiteralExpression,
  name: string,
  ctx?: ResolveCtx
): Promise<string | undefined> {
  const prop = obj.getProperty(name);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!init) return undefined;
  if (ctx) {
    const resolved = await resolveToStringLiteral(init, ctx);
    if (resolved !== undefined) return resolved;
  } else if (init.isKind(SyntaxKind.StringLiteral)) {
    return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  return init.getText();
}

// Parse an array of guard/function identifiers
function getPropIdentifierArray(
  obj: ObjectLiteralExpression,
  name: string
): string[] | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!init || !init.isKind(SyntaxKind.ArrayLiteralExpression)) return undefined;
  return init
    .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
    .getElements()
    .map((e) => e.getText());
}

// Parse resolve object: { key: ResolveFn }
function getPropResolveMap(
  obj: ObjectLiteralExpression,
  name: string
): Record<string, string> | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression)) return undefined;
  const result: Record<string, string> = {};
  for (const p of init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
    if (p.isKind(SyntaxKind.PropertyAssignment)) {
      const pa = p.asKindOrThrow(SyntaxKind.PropertyAssignment);
      const key = pa.getName();
      const val = pa.getInitializer();
      if (val) result[key] = val.getText();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Serialize a data object shallowly (primitives only, drop functions)
function serializeData(
  obj: ObjectLiteralExpression
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const p of obj.getProperties()) {
    if (!p.isKind(SyntaxKind.PropertyAssignment)) continue;
    const pa = p.asKindOrThrow(SyntaxKind.PropertyAssignment);
    const key = pa.getName();
    const val = pa.getInitializer();
    if (!val) continue;
    if (val.isKind(SyntaxKind.StringLiteral)) {
      result[key] = val.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
    } else if (val.isKind(SyntaxKind.NumericLiteral)) {
      result[key] = Number(val.getText());
    } else if (
      val.isKind(SyntaxKind.TrueKeyword) ||
      val.isKind(SyntaxKind.FalseKeyword)
    ) {
      result[key] = val.isKind(SyntaxKind.TrueKeyword);
    } else {
      result[key] = `[expr: ${val.getText()}]`;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Parse the title property (resolves constant references when possible)
async function parseTitleProp(
  obj: ObjectLiteralExpression,
  ctx: ResolveCtx
): Promise<TitleRef | undefined> {
  const prop = obj.getProperty("title");
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!init) return undefined;
  const resolved = await resolveToStringLiteral(init, ctx);
  if (resolved !== undefined) return { source: resolved, kind: "string" };
  return { source: init.getText(), kind: "reference" };
}

function findDefaultReExport(sf: SourceFile): string | undefined {
  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;
    const named = exportDecl.getNamedExports();
    const hasDefault = named.some((n) => n.getName() === "default");
    // export * from '...' or export { default } from '...'
    if (hasDefault || exportDecl.isNamespaceExport()) {
      return moduleSpecifier;
    }
  }
  return undefined;
}

function unwrapRouteExpression(node: Node): Node {
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

function isRouteArrayDeclaration(declaration: ReturnType<SourceFile["getVariableDeclarations"]>[number]): boolean {
  const typeText = declaration.getTypeNode()?.getText().replace(/\s/g, "") ?? "";
  if (
    typeText.includes("Routes") ||
    typeText.includes("Route[]") ||
    typeText.includes("ReadonlyArray<Route>") ||
    typeText.includes("readonlyRoute[]")
  ) {
    return true;
  }
  const initializer = declaration.getInitializer();
  if (!initializer?.isKind(SyntaxKind.SatisfiesExpression)) return false;
  const satisfiesType = initializer
    .asKindOrThrow(SyntaxKind.SatisfiesExpression)
    .getTypeNode()
    ?.getText()
    .replace(/\s/g, "") ?? "";
  return satisfiesType.includes("Routes") || satisfiesType.includes("Route[]");
}

function findRoutesExpression(
  sf: SourceFile,
  requestedExport?: string
): Node | undefined {
  if (requestedExport && requestedExport !== "default") {
    return sf.getVariableDeclaration(requestedExport)?.getInitializer();
  }

  for (const assignment of sf.getExportAssignments()) {
    if (!assignment.isExportEquals()) return assignment.getExpression();
  }
  if (requestedExport === "default") return undefined;

  for (const declaration of sf.getVariableDeclarations()) {
    if (isRouteArrayDeclaration(declaration)) return declaration.getInitializer();
  }
  return undefined;
}

interface RouteElementSource {
  object: ObjectLiteralExpression;
  filePath: string;
  activeExpressions: Set<string>;
}

interface ParseState {
  project: Project;
  info: AngularProjectInfo;
  resolver: RouteSourceResolver;
  warnings: Warning[],
}

function importedBinding(
  sourceFile: SourceFile,
  localName: string
): { specifier: string; exportName: string } | undefined {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (declaration.getDefaultImport()?.getText() === localName) {
      return { specifier, exportName: "default" };
    }
    for (const named of declaration.getNamedImports()) {
      const importedName = named.getNameNode().getText();
      const bindingName = named.getAliasNode()?.getText() ?? importedName;
      if (bindingName === localName) return { specifier, exportName: importedName };
    }
  }
  return undefined;
}

function routeSourceKey(filePath: string, exportName?: string): string {
  return `${resolve(filePath)}#${exportName ?? "<auto>"}`;
}

function addRouteCycleWarning(
  state: ParseState,
  filePath: string,
  exportName?: string,
  line?: number
): void {
  const identity = exportName ? `${filePath}#${exportName}` : filePath;
  state.warnings.push({
    level: "warn",
    message: `Route source cycle detected: ${identity}`,
    file: filePath,
    line,
  });
}

async function resolveRouteElements(
  expression: Node,
  sourceFile: SourceFile,
  state: ParseState,
  activeExpressions: Set<string>
): Promise<RouteElementSource[]> {
  const current = unwrapRouteExpression(expression);
  const filePath = sourceFile.getFilePath();

  if (current.isKind(SyntaxKind.ArrayLiteralExpression)) {
    const result: RouteElementSource[] = [];
    for (const element of current.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
      if (element.isKind(SyntaxKind.ObjectLiteralExpression)) {
        result.push({
          object: element.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
          filePath,
          activeExpressions: new Set(activeExpressions),
        });
        continue;
      }
      if (!element.isKind(SyntaxKind.SpreadElement)) continue;
      const spread = element.asKindOrThrow(SyntaxKind.SpreadElement);
      const spreadExpression = unwrapRouteExpression(spread.getExpression());
      if (spreadExpression.isKind(SyntaxKind.ConditionalExpression)) {
        const conditional = spreadExpression.asKindOrThrow(SyntaxKind.ConditionalExpression);
        const included = await resolveRouteElements(
          conditional.getWhenTrue(),
          sourceFile,
          state,
          activeExpressions
        );
        result.push(...included);
        const plural = included.length === 1 ? "" : "s";
        state.warnings.push({
          level: "info",
          message: `Conditional spread (${conditional.getCondition().getText()}) — ${included.length} route${plural} included from truthy branch`,
          file: filePath,
          line: spread.getStartLineNumber(),
        });
        continue;
      }
      const included = await resolveRouteElements(
        spreadExpression,
        sourceFile,
        state,
        activeExpressions
      );
      if (included.length === 0) {
        state.warnings.push({
          level: "warn",
          message: `Route spread could not be resolved statically: ${spread.getText().slice(0, 80)}`,
          file: filePath,
          line: spread.getStartLineNumber(),
        });
      }
      result.push(...included);
    }
    return result;
  }

  if (!current.isKind(SyntaxKind.Identifier)) return [];
  const identifier = current.asKindOrThrow(SyntaxKind.Identifier);
  const localName = identifier.getText();
  const localDeclaration = sourceFile.getVariableDeclaration(localName);
  if (localDeclaration?.getInitializer()) {
    const key = routeSourceKey(filePath, localName);
    if (activeExpressions.has(key)) {
      addRouteCycleWarning(state, filePath, localName, identifier.getStartLineNumber());
      return [];
    }
    const nextActive = new Set(activeExpressions).add(key);
    return resolveRouteElements(
      localDeclaration.getInitializerOrThrow(),
      sourceFile,
      state,
      nextActive
    );
  }

  const imported = importedBinding(sourceFile, localName);
  if (!imported) return [];
  const resolvedSource = await state.resolver.resolveSource({
    ...imported,
    fromFile: filePath,
  });
  if (!resolvedSource) return [];
  const key = routeSourceKey(resolvedSource.filePath, resolvedSource.exportName);
  if (activeExpressions.has(key)) {
    addRouteCycleWarning(
      state,
      resolvedSource.filePath,
      resolvedSource.exportName,
      identifier.getStartLineNumber()
    );
    return [];
  }
  const targetFile = state.project.addSourceFileAtPathIfExists(resolvedSource.filePath);
  if (!targetFile) return [];
  const targetExpression = findRoutesExpression(targetFile, resolvedSource.exportName);
  if (!targetExpression) return [];
  return resolveRouteElements(
    targetExpression,
    targetFile,
    state,
    new Set(activeExpressions).add(key)
  );
}

async function resolveNgModuleElements(
  sourceFile: SourceFile,
  requestedExport: string | undefined,
  state: ParseState,
  activeModules: Set<string>,
  activeExpressions: Set<string>
): Promise<RouteElementSource[]> {
  const moduleClass = requestedExport && requestedExport !== "default"
    ? sourceFile.getClass(requestedExport)
    : sourceFile.getClasses().find((declaration) => declaration.getDecorator("NgModule"));
  if (!moduleClass) return [];
  const moduleKey = routeSourceKey(sourceFile.getFilePath(), moduleClass.getName());
  if (activeModules.has(moduleKey)) {
    addRouteCycleWarning(state, sourceFile.getFilePath(), moduleClass.getName());
    return [];
  }
  const nextModules = new Set(activeModules).add(moduleKey);
  const decorator = moduleClass.getDecorator("NgModule");
  const metadata = decorator
    ?.getCallExpression()
    ?.getArguments()[0]
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  const importsProperty = metadata?.getProperty("imports")?.asKind(SyntaxKind.PropertyAssignment);
  const importsArray = importsProperty?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
  if (!importsArray) return [];

  const result: RouteElementSource[] = [];
  for (const moduleImport of importsArray.getElements()) {
    if (moduleImport.isKind(SyntaxKind.CallExpression)) {
      const call = moduleImport.asKindOrThrow(SyntaxKind.CallExpression);
      const callee = call.getExpression();
      if (
        callee.isKind(SyntaxKind.PropertyAccessExpression) &&
        callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression().getText() === "RouterModule" &&
        ["forChild", "forRoot"].includes(
          callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
        )
      ) {
        const routesExpression = call.getArguments()[0];
        if (routesExpression) {
          result.push(
            ...(await resolveRouteElements(
              routesExpression,
              sourceFile,
              state,
              activeExpressions
            ))
          );
        }
      }
      continue;
    }
    if (!moduleImport.isKind(SyntaxKind.Identifier)) continue;
    const moduleName = moduleImport.getText();
    const localModule = sourceFile.getClass(moduleName);
    if (localModule) {
      result.push(
        ...(await resolveNgModuleElements(
          sourceFile,
          moduleName,
          state,
          nextModules,
          activeExpressions
        ))
      );
      continue;
    }
    const imported = importedBinding(sourceFile, moduleName);
    if (!imported) continue;
    const resolvedModule = await state.resolver.resolveSource({
      ...imported,
      fromFile: sourceFile.getFilePath(),
    });
    if (!resolvedModule) continue;
    const targetFile = state.project.addSourceFileAtPathIfExists(resolvedModule.filePath);
    if (!targetFile) continue;
    result.push(
      ...(await resolveNgModuleElements(
        targetFile,
        resolvedModule.exportName,
        state,
        nextModules,
        activeExpressions
      ))
    );
  }
  return result;
}

async function parseRoutesFromFile(
  filePath: string,
  parentFullPath: string,
  state: ParseState,
  activeSources: Set<string>,
  requestedExport?: string
): Promise<RouteNode[]> {
  const sourceKey = routeSourceKey(filePath, requestedExport);
  if (activeSources.has(sourceKey)) {
    addRouteCycleWarning(state, filePath, requestedExport);
    return [];
  }
  const nextSources = new Set(activeSources).add(sourceKey);
  const sourceFile = state.project.addSourceFileAtPathIfExists(filePath);
  if (!sourceFile) {
    state.warnings.push({
      level: "warn",
      message: `Unable to read file: ${filePath}`,
      file: filePath,
    });
    return [];
  }

  const expression = findRoutesExpression(sourceFile, requestedExport);
  let elements = expression
    ? await resolveRouteElements(
        expression,
        sourceFile,
        state,
        new Set([sourceKey])
      )
    : await resolveNgModuleElements(
        sourceFile,
        requestedExport,
        state,
        new Set(),
        new Set([sourceKey])
      );

  if (elements.length === 0 && !expression && requestedExport === undefined) {
    const reExportTarget = findDefaultReExport(sourceFile);
    if (reExportTarget) {
      const resolvedSource = await state.resolver.resolveSource({
        specifier: reExportTarget,
        fromFile: filePath,
        exportName: "default",
      });
      if (resolvedSource) {
        return parseRoutesFromFile(
          resolvedSource.filePath,
          parentFullPath,
          state,
          nextSources,
          resolvedSource.exportName
        );
      }
    }
  }

  if (elements.length === 0 && !expression) {
    state.warnings.push({
      level: "warn",
      message: `No Routes array or RouterModule routes found in: ${filePath}`,
      file: filePath,
    });
    return [];
  }
  return parseRouteElements(elements, parentFullPath, state, nextSources);
}

async function parseRouteElements(
  elements: RouteElementSource[],
  parentFullPath: string,
  state: ParseState,
  activeSources: Set<string>
): Promise<RouteNode[]> {
  const nodes: RouteNode[] = [];

  for (const element of elements) {
    const node = await parseRouteObject(
      element.object,
      parentFullPath,
      element.filePath,
      state,
      activeSources,
      element.activeExpressions
    );
    nodes.push(node);
  }

  return nodes;
}

function loaderReturnExpression(expression: Node): Node | undefined {
  const current = unwrapRouteExpression(expression);
  if (!current.isKind(SyntaxKind.ArrowFunction)) return undefined;
  const body = current.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  if (!body.isKind(SyntaxKind.Block)) return unwrapRouteExpression(body);
  for (const statement of body.asKindOrThrow(SyntaxKind.Block).getStatements()) {
    if (!statement.isKind(SyntaxKind.ReturnStatement)) continue;
    const returned = statement.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
    return returned ? unwrapRouteExpression(returned) : undefined;
  }
  return undefined;
}

async function parseRouteObject(
  obj: ObjectLiteralExpression,
  parentFullPath: string,
  filePath: string,
  state: ParseState,
  activeSources: Set<string>,
  activeExpressions: Set<string>
): Promise<RouteNode> {
  const { project, info, resolver, warnings } = state;
  const sourceLine = obj.getStartLineNumber();
  const ctx: ResolveCtx = { project, info, resolver, sourceFile: obj.getSourceFile() };

  // path
  const pathRaw = await getPropString(obj, "path", ctx);
  const path = pathRaw ?? "";
  // If still an unresolved identifier expression (fallback), strip object prefix
  const cleanPath = /^[A-Z_]+\.[A-Z_]+$/.test(path)
    ? path.split(".").pop()!.toLowerCase().replace(/_/g, "-")
    : path;

  // fullPath computation
  const fullPath = normalizePath(
    cleanPath === "" ? parentFullPath : `${parentFullPath}/${cleanPath}`
  );

  const id = makeId(filePath, sourceLine, fullPath);

  // Simple string props
  const redirectTo = await getPropString(obj, "redirectTo", ctx);
  const pathMatch = (await getPropString(obj, "pathMatch", ctx)) as
    | "full"
    | "prefix"
    | undefined;
  const outlet = await getPropString(obj, "outlet", ctx);
  const runGuardsAndResolvers = await getPropString(obj, "runGuardsAndResolvers", ctx);

  // matcher
  const matcherProp = obj.getProperty("matcher");
  const matcher = matcherProp?.isKind(SyntaxKind.PropertyAssignment)
    ? matcherProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()?.getText()
    : undefined;

  // component
  const componentProp = obj.getProperty("component");
  const component = componentProp?.isKind(SyntaxKind.PropertyAssignment)
    ? componentProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()?.getText()
    : undefined;

  // title
  const title = await parseTitleProp(obj, ctx);

  // guard arrays
  const canActivate = getPropIdentifierArray(obj, "canActivate");
  const canActivateChild = getPropIdentifierArray(obj, "canActivateChild");
  const canDeactivate = getPropIdentifierArray(obj, "canDeactivate");
  const canMatch = getPropIdentifierArray(obj, "canMatch");
  const canLoad = getPropIdentifierArray(obj, "canLoad");

  // resolve map
  const resolveMap = getPropResolveMap(obj, "resolve");

  // providers
  const providers = getPropIdentifierArray(obj, "providers");

  // data
  let data: Record<string, unknown> | undefined;
  const dataProp = obj.getProperty("data");
  if (dataProp?.isKind(SyntaxKind.PropertyAssignment)) {
    const dataInit = dataProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (dataInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
      data = serializeData(dataInit.asKindOrThrow(SyntaxKind.ObjectLiteralExpression));
    }
  }

  // loadComponent
  let loadComponent: LazyRef | undefined;
  const lcProp = obj.getProperty("loadComponent");
  if (lcProp?.isKind(SyntaxKind.PropertyAssignment)) {
    const lcInit = lcProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (lcInit) {
      const dynImport = extractLazyRouteImport(lcInit);
      if (dynImport) {
        const resolvedSource = await resolver.resolveSource({
          specifier: dynImport.specifier,
          fromFile: filePath,
          exportName: dynImport.exportName,
        });
        loadComponent = {
          source: dynImport.specifier,
          resolvedFile: resolvedSource?.filePath,
        };
      } else {
        loadComponent = { source: lcInit.getText() };
      }
    }
  }

  // loadChildren — recurse if resolvable
  let loadChildren: LazyRef | undefined;
  let children: RouteNode[] = [];

  const ldProp = obj.getProperty("loadChildren");
  if (ldProp?.isKind(SyntaxKind.PropertyAssignment)) {
    const ldInit = ldProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (ldInit) {
      const dynImport = extractLazyRouteImport(ldInit);
      if (dynImport) {
        const resolvedSource = await resolver.resolveSource({
          specifier: dynImport.specifier,
          fromFile: filePath,
          exportName: dynImport.exportName,
        });
        const resolved = resolvedSource?.filePath;
        loadChildren = { source: dynImport.specifier, resolvedFile: resolved };

        if (resolved && resolved.endsWith(".ts")) {
          children = await parseRoutesFromFile(
            resolved,
            fullPath,
            state,
            activeSources,
            resolvedSource?.exportName
          );
        }
      } else {
        loadChildren = { source: ldInit.getText() };
        const returned = loaderReturnExpression(ldInit);
        const routeElements = returned
          ? await resolveRouteElements(
              returned,
              obj.getSourceFile(),
              state,
              new Set(activeExpressions)
            )
          : [];
        if (routeElements.length > 0) {
          children = await parseRouteElements(
            routeElements,
            fullPath,
            state,
            activeSources
          );
        } else {
          warnings.push({
            level: "warn",
            message: `Unable to statically resolve loadChildren: ${ldInit.getText()}`,
            file: filePath,
            line: ldInit.getStartLineNumber(),
          });
        }
      }
    }
  }

  // Inline children
  const childrenProp = obj.getProperty("children");
  if (childrenProp?.isKind(SyntaxKind.PropertyAssignment) && (!loadChildren || children.length === 0)) {
    const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (childInit) {
      const childElements = await resolveRouteElements(
        childInit,
        obj.getSourceFile(),
        state,
        new Set(activeExpressions)
      );
      children = await parseRouteElements(
        childElements,
        fullPath,
        state,
        activeSources
      );
    }
  }

  // Determine type
  let type: RouteType;
  if (cleanPath === "**") {
    type = "wildcard";
  } else if (redirectTo !== undefined) {
    type = "redirect";
  } else if (loadChildren !== undefined) {
    type = "lazy-module";
  } else if (loadComponent !== undefined) {
    type = "lazy-component";
  } else {
    type = "route";
  }

  const node: RouteNode = {
    id,
    path: cleanPath,
    fullPath,
    type,
    sourceFile: filePath,
    sourceLine,
    children,
  };

  if (component) node.component = component;
  if (loadChildren) node.loadChildren = loadChildren;
  if (loadComponent) node.loadComponent = loadComponent;
  if (redirectTo !== undefined) node.redirectTo = redirectTo;
  if (pathMatch) node.pathMatch = pathMatch;
  if (outlet) node.outlet = outlet;
  if (title) node.title = title;
  if (data) node.data = data;
  if (canActivate?.length) node.canActivate = canActivate;
  if (canActivateChild?.length) node.canActivateChild = canActivateChild;
  if (canDeactivate?.length) node.canDeactivate = canDeactivate;
  if (canMatch?.length) node.canMatch = canMatch;
  if (canLoad?.length) node.canLoad = canLoad;
  if (resolveMap && Object.keys(resolveMap).length) node.resolve = resolveMap;
  if (providers?.length) node.providers = providers;
  if (runGuardsAndResolvers) node.runGuardsAndResolvers = runGuardsAndResolvers;
  if (matcher) node.matcher = matcher;

  return node;
}

// ─── public API ─────────────────────────────────────────────────────────────

export async function buildRouteGraph(
  entryFile: string,
  info: AngularProjectInfo
): Promise<RouteGraph> {
  const warnings: Warning[] = [];

  const project = new Project({
    tsConfigFilePath: info.tsconfigPath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      skipLibCheck: true,
      allowJs: true,
      // Don't emit
      noEmit: true,
    },
  });
  const resolver = createRouteSourceResolver(info, project);
  const state: ParseState = { project, info, resolver, warnings };

  const roots = await parseRoutesFromFile(
    resolve(entryFile),
    "",
    state,
    new Set()
  );
  warnings.push(...resolver.warnings);

  return {
    roots,
    warnings,
    metadata: {
      projectName: info.projectName,
      angularVersion: info.angularVersion,
      scannedAt: new Date().toISOString(),
      entryFile: resolve(entryFile),
    },
  };
}
