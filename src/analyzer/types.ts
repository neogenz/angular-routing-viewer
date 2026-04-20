// Angular Route interface (v17+, compatible v21) supported properties:
// - path, pathMatch ('full' | 'prefix')
// - component, loadComponent
// - loadChildren, children
// - redirectTo
// - outlet
// - matcher (UrlMatcher)
// - canActivate, canActivateChild, canDeactivate, canMatch
// - canLoad (deprecated in favor of canMatch)
// - resolve (ResolveFn<T> map)
// - data (static metadata)
// - title (string | ResolveFn<string> | Type<Resolve<string>>)
// - providers (Provider[])
// - runGuardsAndResolvers
//
// Functional guards: CanActivateFn, CanMatchFn, CanDeactivateFn, ResolveFn<T>.

export type RouteType =
  | "route"
  | "lazy-module"
  | "lazy-component"
  | "redirect"
  | "wildcard";

export interface LazyRef {
  source: string;
  resolvedFile?: string;
}

export interface TitleRef {
  source: string;
  kind: "string" | "ResolveFn" | "reference";
}

export interface RouteNode {
  id: string;
  path: string;
  fullPath: string;
  type: RouteType;
  component?: string;
  loadChildren?: LazyRef;
  loadComponent?: LazyRef;
  redirectTo?: string;
  pathMatch?: "full" | "prefix";
  outlet?: string;
  title?: TitleRef;
  data?: Record<string, unknown>;
  canActivate?: string[];
  canActivateChild?: string[];
  canDeactivate?: string[];
  canMatch?: string[];
  canLoad?: string[];
  resolve?: Record<string, string>;
  providers?: string[];
  runGuardsAndResolvers?: string;
  matcher?: string;
  children: RouteNode[];
  sourceFile: string;
  sourceLine: number;
}

export interface Warning {
  level: "warn" | "info";
  message: string;
  file?: string;
  line?: number;
}

export interface GraphMetadata {
  angularVersion?: string;
  projectName: string;
  scannedAt: string;
  entryFile: string;
}

export interface RouteGraph {
  roots: RouteNode[];
  warnings: Warning[];
  metadata: GraphMetadata;
}

export interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export interface AngularProjectInfo {
  projectRoot: string;
  projectName: string;
  sourceRoot: string;
  angularJsonPath?: string;
  tsconfigPaths: TsconfigPaths;
  angularVersion?: string;
}
