import type { Routes } from "@angular/router";

const reportRoutes: Routes = [
  { path: "monthly" },
  {
    path: "archive",
    children: [{ path: ":year" }],
  },
];

export default reportRoutes;
