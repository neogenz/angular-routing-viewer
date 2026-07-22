import type { Routes } from "@angular/router";

export const appRoutes: Routes = [
  {
    path: "orders",
    loadChildren: () =>
      import("@acme/orders").then((module) => module.ordersRoutes),
  },
];
