import type { Route, Routes } from "@angular/router";
import {
  cycleTailRoutes,
  orderDetailRoutes,
  readonlyDetailRoutes,
  sharedDetailRoutes,
} from "@acme/routes/order-detail";

export const unrelatedRoutes: Routes = [{ path: "not-orders" }];

const listRoutes: Route[] = [{ path: "list" }];

export const ordersRoutes: Routes = [
  ...listRoutes,
  ...orderDetailRoutes,
  ...readonlyDetailRoutes,
  {
    path: "draft",
    children: sharedDetailRoutes,
  },
  {
    path: "archived",
    children: sharedDetailRoutes,
  },
  ...cycleTailRoutes,
];

const defaultOrdersRoutes: Routes = [{ path: "default-orders" }];

export default defaultOrdersRoutes;
