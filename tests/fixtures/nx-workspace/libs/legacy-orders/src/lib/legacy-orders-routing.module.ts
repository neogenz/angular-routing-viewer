import { NgModule } from "@angular/core";
import { RouterModule, type Route } from "@angular/router";

const legacyOrderRoutes: Route[] = [
  { path: "archive" },
];

@NgModule({
  imports: [RouterModule.forChild(legacyOrderRoutes)],
  exports: [RouterModule],
})
export class LegacyOrdersRoutingModule {}
