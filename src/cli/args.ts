import { parseArgs } from "util";

export interface CliOptions {
  targetPath: string;
  output?: string;
  entry?: string;
  project?: string;
  open: boolean;
  json: boolean;
  verbose: boolean;
  help: boolean;
}

export function parseCliArgs(): CliOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      output: { type: "string" },
      entry: { type: "string" },
      project: { type: "string" },
      open: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  return {
    targetPath: positionals[0] ?? process.cwd(),
    output: values.output,
    entry: values.entry,
    project: values.project,
    open: values.open ?? false,
    json: values.json ?? false,
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };
}
