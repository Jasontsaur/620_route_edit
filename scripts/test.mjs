import ts from "typescript";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
for (const source of [
  "lib/route.ts",
  "lib/files.ts",
  "lib/xml-track.ts",
  "lib/compact-import.ts",
  "lib/elevation.ts",
  "lib/version-owner.ts",
  "lib/maps-settings.ts",
  "tests/route.test.ts",
]) {
  const output = ts
    .transpileModule(await readFile(source, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /(['"])(\.\.?\/(?:lib\/)?(?:route|files|elevation|version-owner|maps-settings|compact-import|xml-track))\1/g,
      "$1$2.mjs$1",
    );
  const target = ".sites-runtime/test/" + source.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output);
}
const result = spawnSync(
  process.execPath,
  ["--test", ".sites-runtime/test/tests/route.test.mjs"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
