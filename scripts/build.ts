#!/usr/bin/env bun
// Bundles the CLI to a single Node-runnable file for npm publishing.
// Runtime deps (ts-morph, @clack/prompts) stay external — npm installs them.
import { chmod } from "node:fs/promises";

const outfile = "dist/ngrv.js";

const result = await Bun.build({
  entrypoints: ["./bin/ngrv.ts"],
  outdir: "dist",
  target: "node",
  naming: "ngrv.js",
  external: ["ts-morph", "@clack/prompts"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// The entry shebang is `#!/usr/bin/env bun`; the published bin must run under Node.
const code = await Bun.file(outfile).text();
await Bun.write(outfile, code.replace(/^#![^\n]*\n/, "#!/usr/bin/env node\n"));
await chmod(outfile, 0o755);

console.log(`Built ${outfile}`);
