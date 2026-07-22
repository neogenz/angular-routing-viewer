import { readFile } from "fs/promises";
import { join } from "path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { createRouteSourceResolver } from "./route-source-resolver.js";
import type { AngularProjectInfo } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function importedRoute(
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

function findProvideRouterArgument(sourceFile: SourceFile) {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!expression.isKind(SyntaxKind.Identifier) || expression.getText() !== "provideRouter") continue;
    let argument = call.getArguments()[0];
    while (argument?.isKind(SyntaxKind.CallExpression)) {
      const nestedArguments = argument.asKindOrThrow(SyntaxKind.CallExpression).getArguments();
      if (nestedArguments.length !== 1) break;
      argument = nestedArguments[0];
    }
    return argument;
  }
  return undefined;
}

async function findProviderEntry(
  appConfig: string,
  projectInfo: AngularProjectInfo
): Promise<string> {
  const project = new Project({
    tsConfigFilePath: projectInfo.tsconfigPath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, noEmit: true, skipLibCheck: true },
  });
  const sourceFile = project.addSourceFileAtPath(appConfig);
  const argument = findProvideRouterArgument(sourceFile);
  if (!argument) {
    throw new Error(`Could not statically resolve provideRouter routes in: ${appConfig}`);
  }
  if (!argument.isKind(SyntaxKind.Identifier)) {
    throw new Error(
      `Could not statically resolve dynamic provideRouter argument '${argument.getText()}' in: ${appConfig}`
    );
  }

  const routeName = argument.getText();
  const imported = importedRoute(sourceFile, routeName);
  if (!imported) {
    if (sourceFile.getVariableDeclaration(routeName)) return appConfig;
    throw new Error(`Could not find import for provideRouter routes '${routeName}' in: ${appConfig}`);
  }

  const resolver = createRouteSourceResolver(projectInfo, project);
  const resolvedSource = await resolver.resolveSource({
    ...imported,
    fromFile: appConfig,
  });
  if (resolvedSource) return resolvedSource.filePath;
  const detail = resolver.warnings.map((warning) => warning.message).join("; ");
  throw new Error(
    `Could not resolve provideRouter routes '${routeName}' in: ${appConfig}${detail ? ` - ${detail}` : ""}`
  );
}

export async function findRouteEntry(
  projectInfo: AngularProjectInfo
): Promise<string> {
  const { sourceRoot } = projectInfo;
  const appDir = join(sourceRoot, "app");

  const appRoutes = join(appDir, "app.routes.ts");
  if (await exists(appRoutes)) return appRoutes;

  const appRoutingModule = join(appDir, "app-routing.module.ts");
  if (await exists(appRoutingModule)) return appRoutingModule;

  const appConfig = join(appDir, "app.config.ts");
  if (await exists(appConfig)) return findProviderEntry(appConfig, projectInfo);

  throw new Error(
    `Could not find Angular routes file in: ${sourceRoot}. ` +
      `Searched: app/app.routes.ts, app/app-routing.module.ts, app/app.config.ts`
  );
}
