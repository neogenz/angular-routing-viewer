import type { ApplicationConfig } from "@angular/core";
import { provideRouter } from "@angular/router";
import { rootRoutes as configuredRoutes } from "@acme/provider-routes";

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(configuredRoutes)],
};
