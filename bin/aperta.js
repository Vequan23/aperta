#!/usr/bin/env node
try { await import("../dist-cli/src/cli.js"); }
catch (error) { console.error(`aperta: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
