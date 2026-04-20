import { readFile } from "fs/promises";
import { join } from "path";
import type { AngularProjectInfo } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function findRouteEntry(
  projectInfo: AngularProjectInfo
): Promise<string> {
  const { sourceRoot } = projectInfo;
  const appDir = join(sourceRoot, "app");

  // 1. app.routes.ts
  const appRoutes = join(appDir, "app.routes.ts");
  if (await exists(appRoutes)) {
    return appRoutes;
  }

  // 2. app-routing.module.ts
  const appRoutingModule = join(appDir, "app-routing.module.ts");
  if (await exists(appRoutingModule)) {
    return appRoutingModule;
  }

  // 3. app.config.ts — look for provideRouter(XXX) and trace XXX to its import
  const appConfig = join(appDir, "app.config.ts");
  if (await exists(appConfig)) {
    const content = await readFile(appConfig, "utf-8");
    const provideRouterMatch = content.match(
      /provideRouter\(\s*(?:withRoutes\(\s*)?(\w+)/
    );
    if (provideRouterMatch) {
      const routesVar = provideRouterMatch[1];
      // Look for an import of that variable
      const importMatch = content.match(
        new RegExp(`import\\s*\\{[^}]*\\b${routesVar}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`)
      );
      if (importMatch) {
        const importPath = importMatch[1];
        const candidates = [
          importPath + ".ts",
          importPath + ".routes.ts",
          join(appDir, importPath + ".ts"),
          join(appDir, importPath + ".routes.ts"),
        ];
        for (const c of candidates) {
          if (await exists(c)) return c;
        }
      }
    }
    return appConfig;
  }

  throw new Error(
    `Could not find Angular routes file in: ${sourceRoot}. ` +
      `Searched: app/app.routes.ts, app/app-routing.module.ts, app/app.config.ts`
  );
}
