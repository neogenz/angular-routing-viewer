import type { Routes } from "@angular/router";

async function loadRoutesAtRuntime(): Promise<Routes> {
  return [];
}

export const appRoutes: Routes = [
  {
    path: "orders",
    loadChildren: () =>
      import("@acme/orders").then((module) => module.ordersRoutes),
  },
  {
    path: "legacy",
    loadChildren: () =>
      import("@acme/legacy-orders").then(
        (module) => module.LegacyOrdersModule,
      ),
  },
  {
    path: "runtime",
    loadChildren: () => loadRoutesAtRuntime(),
  },
];
