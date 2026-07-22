import type { Routes } from "@angular/router";

export const unrelatedRoutes: Routes = [{ path: "not-orders" }];

export const ordersRoutes: Routes = [{ path: "list" }];

const defaultOrdersRoutes: Routes = [{ path: "default-orders" }];

export default defaultOrdersRoutes;
