const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR;

export const c = {
  reset: isColorSupported ? "\x1b[0m" : "",
  bold: isColorSupported ? "\x1b[1m" : "",
  dim: isColorSupported ? "\x1b[2m" : "",
  green: isColorSupported ? "\x1b[32m" : "",
  yellow: isColorSupported ? "\x1b[33m" : "",
  red: isColorSupported ? "\x1b[31m" : "",
  cyan: isColorSupported ? "\x1b[36m" : "",
  magenta: isColorSupported ? "\x1b[35m" : "",
  blue: isColorSupported ? "\x1b[34m" : "",
  gray: isColorSupported ? "\x1b[90m" : "",
};

export function showHeader(version: string): void {
  const banner = [
    `${c.cyan}ngrv${c.reset} ${c.dim}v${version}${c.reset} ${c.gray}- Angular Routing Viewer${c.reset}`,
  ].join("\n");
  console.log(banner);
}

export function printHelp(version: string): void {
  console.log(`${c.bold}ngrv${c.reset} v${version} - Angular Routing Viewer

${c.bold}Usage:${c.reset}
  bunx ngrv [path] [options]

${c.bold}Arguments:${c.reset}
  path                  Path to the Angular project (default: cwd)

${c.bold}Options:${c.reset}
  --output <dir>        Output directory (default: ./angular-routing)
  --entry <file>        Explicit root routes file (default: auto-detected)
  --project <name>      Project name in a multi-app workspace
  --open                Open the graph in the browser after generation
  --json                Write data.json only (no HTML) to stdout
  --verbose             Print analyzed files and detailed warnings
  --help, -h            Show this help

${c.bold}Examples:${c.reset}
  bunx ngrv
  bunx ngrv ./my-angular-app --open
  bunx ngrv --entry src/app/app.routes.ts
`);
}
