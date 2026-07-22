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

// Check if a file is a barrel that re-exports default from another file
// e.g. "export { default } from './welcome.routes'"
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

// Strip `as T` and `satisfies T` wrappers (either order, possibly nested).
function unwrapTypeAssertion(expr: Expression): Expression {
  let current = expr;
  while (
    current.isKind(SyntaxKind.AsExpression) ||
    current.isKind(SyntaxKind.SatisfiesExpression)
  ) {
    current = current.isKind(SyntaxKind.AsExpression)
      ? current.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
      : current.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression();
  }
  return current;
}

// Find the Routes array in a SourceFile
// Priority: export default > first exported Routes var > first `: Routes =` var
function findRoutesArray(
  sf: SourceFile,
  requestedExport?: string
): ArrayLiteralExpression | undefined {
  if (requestedExport && requestedExport !== "default") {
    const declaration = sf.getVariableDeclaration(requestedExport);
    const initializer = declaration?.getInitializer();
    if (initializer) {
      const expression = unwrapTypeAssertion(initializer);
      if (expression.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return expression.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      }
    }
    return undefined;
  }

  // 1. export default [...] (optionally `as Routes` / `satisfies Routes`)
  // 2. export default xxx (where xxx is a Routes var)
  const defaultExport = sf.getDefaultExportSymbol();
  if (defaultExport) {
    const decls = defaultExport.getDeclarations();
    for (const decl of decls) {
      if (decl.isKind(SyntaxKind.ExportAssignment)) {
        const expr = unwrapTypeAssertion(
          decl.asKindOrThrow(SyntaxKind.ExportAssignment).getExpression()
        );
        if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) {
          return expr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
        }
        // export default identifier → find it
        if (expr.isKind(SyntaxKind.Identifier)) {
          const name = expr.getText();
          const varDecl = sf.getVariableDeclaration(name);
          if (varDecl) {
            const init = varDecl.getInitializer();
            if (init?.isKind(SyntaxKind.ArrayLiteralExpression)) {
              return init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
            }
          }
        }
      }
    }
  }

  // 3. export const xxx: Routes = [...]
  for (const varStatement of sf.getVariableStatements()) {
    for (const decl of varStatement.getDeclarations()) {
      const typeNode = decl.getTypeNode();
      const init = decl.getInitializer();
      if (
        typeNode &&
        typeNode.getText().replace(/\s/g, "").includes("Routes") &&
        init?.isKind(SyntaxKind.ArrayLiteralExpression)
      ) {
        return init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      }
    }
  }

  return undefined;
}

// Flatten an array literal, expanding spread ternaries into their whenTrue branch
function flattenElements(
  arr: ArrayLiteralExpression,
  warnings: Warning[],
  filePath: string
): ObjectLiteralExpression[] {
  const result: ObjectLiteralExpression[] = [];

  for (const elem of arr.getElements()) {
    if (elem.isKind(SyntaxKind.ObjectLiteralExpression)) {
      result.push(elem.asKindOrThrow(SyntaxKind.ObjectLiteralExpression));
    } else if (elem.isKind(SyntaxKind.SpreadElement)) {
      // ...(isDevMode() ? [...] : [])
      const spread = elem.asKindOrThrow(SyntaxKind.SpreadElement);
      const spreadLine = spread.getStartLineNumber();
      let inner: Node = spread.getExpression();

      if (inner.isKind(SyntaxKind.ParenthesizedExpression)) {
        inner = inner.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
      }

      if (inner.isKind(SyntaxKind.ConditionalExpression)) {
        const cond = inner.asKindOrThrow(SyntaxKind.ConditionalExpression);
        const whenTrue = cond.getWhenTrue();
        const condText = cond.getCondition().getText();
        let addedCount = 0;
        if (whenTrue.isKind(SyntaxKind.ArrayLiteralExpression)) {
          const truthyArr = whenTrue.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          const flattened = flattenElements(truthyArr, warnings, filePath);
          addedCount = flattened.length;
          result.push(...flattened);
        }
        const plural = addedCount === 1 ? "" : "s";
        warnings.push({
          level: "info",
          message: `Conditional spread (${condText}) — ${addedCount} route${plural} included from truthy branch`,
          file: filePath,
          line: spreadLine,
        });
      } else {
        warnings.push({
          level: "warn",
          message: `Non-ternary spread skipped: ${elem.getText().slice(0, 60)}`,
          file: filePath,
          line: spreadLine,
        });
      }
    }
  }

  return result;
}

// Core recursive parser
async function parseRoutesFromFile(
  filePath: string,
  parentFullPath: string,
  project: Project,
  info: AngularProjectInfo,
  resolver: RouteSourceResolver,
  warnings: Warning[],
  visited: Map<string, RouteNode[]>,
  requestedExport?: string
): Promise<RouteNode[]> {
  if (visited.has(filePath)) {
    warnings.push({
      level: "info",
      message: `Cycle detected, already parsed: ${filePath}`,
      file: filePath,
    });
    return [];
  }

  // Mark as in-progress with empty array to detect cycles
  visited.set(filePath, []);

  let sf: SourceFile;
  try {
    sf = project.addSourceFileAtPath(filePath);
  } catch (e) {
    warnings.push({
      level: "warn",
      message: `Unable to read file: ${filePath} - ${String(e)}`,
      file: filePath,
    });
    return [];
  }

  const routesArray = findRoutesArray(sf, requestedExport);
  if (!routesArray) {
    // Check for barrel re-export: export { default } from './foo' or export * from './foo'
    const reExportTarget = findDefaultReExport(sf);
    if (reExportTarget) {
      const resolved = await resolver.resolveImport(reExportTarget, filePath);
      if (resolved && resolved !== filePath) {
        return parseRoutesFromFile(
          resolved,
          parentFullPath,
          project,
          info,
          resolver,
          warnings,
          visited
        );
      }
    }

    warnings.push({
      level: "warn",
      message: `No Routes array found in: ${filePath}`,
      file: filePath,
    });
    return [];
  }

  const elements = flattenElements(routesArray, warnings, filePath);
  const nodes = await parseRouteElements(
    elements,
    parentFullPath,
    filePath,
    project,
    info,
    resolver,
    warnings,
    visited
  );

  visited.set(filePath, nodes);
  return nodes;
}

async function parseRouteElements(
  elements: ObjectLiteralExpression[],
  parentFullPath: string,
  filePath: string,
  project: Project,
  info: AngularProjectInfo,
  resolver: RouteSourceResolver,
  warnings: Warning[],
  visited: Map<string, RouteNode[]>
): Promise<RouteNode[]> {
  const nodes: RouteNode[] = [];

  for (const obj of elements) {
    const node = await parseRouteObject(
      obj,
      parentFullPath,
      filePath,
      project,
      info,
      resolver,
      warnings,
      visited
    );
    nodes.push(node);
  }

  return nodes;
}

async function parseRouteObject(
  obj: ObjectLiteralExpression,
  parentFullPath: string,
  filePath: string,
  project: Project,
  info: AngularProjectInfo,
  resolver: RouteSourceResolver,
  warnings: Warning[],
  visited: Map<string, RouteNode[]>
): Promise<RouteNode> {
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
            project,
            info,
            resolver,
            warnings,
            visited,
            resolvedSource?.exportName
          );
        }
      } else {
        loadChildren = { source: ldInit.getText() };
      }
    }
  }

  // Inline children
  const childrenProp = obj.getProperty("children");
  if (
    childrenProp?.isKind(SyntaxKind.PropertyAssignment) &&
    !loadChildren // don't overwrite with empty if loadChildren already gave us children
  ) {
    const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (childInit?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const childElems = flattenElements(
        childInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression),
        warnings,
        filePath
      );
      children = await parseRouteElements(
        childElems,
        fullPath,
        filePath,
        project,
        info,
        resolver,
        warnings,
        visited
      );
    }
  } else if (
    childrenProp?.isKind(SyntaxKind.PropertyAssignment) &&
    loadChildren &&
    children.length === 0
  ) {
    // has both loadChildren AND inline children — parse inline too
    const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (childInit?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const childElems = flattenElements(
        childInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression),
        warnings,
        filePath
      );
      children = await parseRouteElements(
        childElems,
        fullPath,
        filePath,
        project,
        info,
        resolver,
        warnings,
        visited
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

  const visited = new Map<string, RouteNode[]>();

  const roots = await parseRoutesFromFile(
    resolve(entryFile),
    "",
    project,
    info,
    resolver,
    warnings,
    visited
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
