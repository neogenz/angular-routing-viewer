import { provideRouter } from "@angular/router";
import { missingRoutes } from "@acme/missing-routes";

export const appConfig = { providers: [provideRouter(missingRoutes)] };
