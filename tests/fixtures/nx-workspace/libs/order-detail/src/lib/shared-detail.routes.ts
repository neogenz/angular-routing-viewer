import type { Route, Routes } from "@angular/router";
import { recursiveDetailRoutes } from "./order-detail.routes";

export const orderHistoryRoutes = [
  { path: "history" },
] satisfies Routes;

export const sharedDetailRoutes: Route[] = [
  { path: "summary" },
];

export const readonlyDetailRoutes: readonly Route[] = [
  { path: "readonly" },
];

export const cycleTailRoutes: Routes = [
  {
    path: "cycle-start",
    children: recursiveDetailRoutes,
  },
  { path: "shared-cycle-sibling" },
];
