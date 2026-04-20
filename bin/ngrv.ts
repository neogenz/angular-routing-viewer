#!/usr/bin/env bun
import { run } from "../src/index";

run().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\x1b[31mFatal error:\x1b[0m ${msg}`);
  process.exit(1);
});
