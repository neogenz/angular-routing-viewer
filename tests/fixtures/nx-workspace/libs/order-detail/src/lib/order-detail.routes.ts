import type { Route } from "@angular/router";
import {
  cycleTailRoutes,
  orderHistoryRoutes,
} from "./shared-detail.routes";

export {
  cycleTailRoutes,
  readonlyDetailRoutes,
  sharedDetailRoutes,
} from "./shared-detail.routes";

export const orderDetailRoutes: Route[] = [
  {
    path: ":id",
    children: orderHistoryRoutes,
  },
];

export const recursiveDetailRoutes: Route[] = [
  {
    path: "detail-cycle",
    children: cycleTailRoutes,
  },
  { path: "order-cycle-sibling" },
];
