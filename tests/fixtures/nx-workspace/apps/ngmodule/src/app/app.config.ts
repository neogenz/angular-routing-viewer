import { provideRouter } from "@angular/router";

export const appConfig = { providers: [provideRouter(buildRoutes())] };

declare function buildRoutes(): never[];
