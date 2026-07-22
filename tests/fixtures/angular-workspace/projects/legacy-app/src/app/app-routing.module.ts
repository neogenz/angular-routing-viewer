import { NgModule } from "@angular/core";
import { RouterModule, type Routes } from "@angular/router";

const routes: Routes = [
  {
    path: "",
    redirectTo: "dashboard",
    pathMatch: "full",
  },
  {
    path: "dashboard",
    children: [
      { path: "overview" },
      { path: "settings" },
    ],
  },
  {
    path: "reports",
    loadChildren: () => import("./reports.routes"),
  },
  {
    path: "**",
    redirectTo: "dashboard",
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
