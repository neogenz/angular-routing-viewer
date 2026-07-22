import type { ApplicationConfig } from "@angular/core";
import { provideRouter } from "@angular/router";
import { appRoutes as rootRoutes } from "@acme/admin-routes";

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(rootRoutes)],
};
