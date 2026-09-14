import solidTransformPlugin from "@opentui/solid/bun-plugin";
import fs from "fs";
import path from "path";

async function build(): Promise<void> {
  const srcDir = path.join(import.meta.dir, "src");
  const outDir = path.join(import.meta.dir, "dist");
  const entrypoints = [path.join(srcDir, "tui.tsx")];
  const external = [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opencode-ai/plugin/v1",
    "@opencode-ai/plugin/v1/tui",
    "@opentui/core",
    "@opentui/keymap",
    "@opentui/solid",
    "@opentui/solid/jsx-runtime",
    "solid-js",
    "solid-js/web",
    "zod",
  ];

  fs.rmSync(outDir, { recursive: true, force: true });

  for (const format of ["esm", "cjs"] as const) {
    const result = await Bun.build({
      entrypoints,
      outdir: outDir,
      root: srcDir,
      format,
      naming: { entry: `[dir]/[name].${format === "esm" ? "mjs" : "js"}` },
      target: "node",
      external,
      plugins: [solidTransformPlugin],
      minify: false,
      splitting: false,
    });

    if (!result.success) {
      console.error(`${format.toUpperCase()} build failed:`, result.logs);
      process.exit(1);
    }
  }

  // Override the root ESM package scope for generated .js files.
  const distPkgPath = path.join(outDir, "package.json");
  await Bun.write(distPkgPath, JSON.stringify({ type: "commonjs" }, null, 2));
  console.log("✓ Created dist/package.json with type: commonjs");

  const tscProcess = Bun.spawn(["bunx", "tsc", "--emitDeclarationOnly", "--declaration", "--outDir", "dist"], {
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await tscProcess.exited;
  
  if (exitCode !== 0) {
    console.error("Type declaration generation failed");
    process.exit(1);
  }

  console.log("✓ Build completed successfully");
  console.log("  - dist/tui.mjs (TUI plugin)");
  console.log("  - dist/tui.js (internal CommonJS TUI artifact, not package-exported)");
  console.log("  - dist/tui.d.ts (TUI declarations)");
}

if (import.meta.main) {
  build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}

export { build };
