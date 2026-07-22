import type { Routes } from "@angular/router";

export const defaultComponentRoutes: Routes = [
  {
    path: "default-component",
    loadComponent: () => import("@acme/default-component"),
  },
];
