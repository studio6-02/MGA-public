import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePublicRuntime } from "./public-export-model.mjs";
import { parseYamlLite } from "./yaml-lite.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = join(root, "public/datasets");
const demoRoot = join(datasetRoot, "demo");
const universe = readJson(join(demoRoot, "universe.json"));
const galaxies = readdirSync(join(demoRoot, "galaxies"))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => readJson(join(demoRoot, "galaxies", name)));
const factCatalog = parseYamlLite(readFileSync(join(root, "data/molecule-facts.yml"), "utf8"));
const manifest = readJson(join(root, "release-manifest.json"));
const errors = validatePublicRuntime({ universe, galaxies, factCatalog });

if (Number(universe.moleculeCount) < 3000) {
  errors.push(`Phase 1 public release requires at least 3000 molecules; found ${universe.moleculeCount}.`);
}
if (manifest.moleculeCount !== universe.moleculeCount) errors.push("Release manifest moleculeCount does not match runtime data.");
if (manifest.referenceCount !== universe.referenceCount) errors.push("Release manifest referenceCount does not match runtime data.");
if (manifest.factCount !== (factCatalog.molecules ?? []).length) errors.push("Release manifest factCount does not match public facts.");
if (manifest.familyCount !== (universe.galaxies ?? []).length) errors.push("Release manifest familyCount does not match runtime data.");
if (manifest.datasetSha256 !== hashDirectory(datasetRoot)) errors.push("Release manifest datasetSha256 does not match public datasets.");

for (const forbidden of ["molecule-facts.yml", "data/fact-research", "data/legacy-molecule-facts.yml"]) {
  if (existsSync(join(root, forbidden))) errors.push(`Private-only path is present: ${forbidden}`);
}
for (const file of listFiles(root, new Set([".git", "dist", "node_modules"]))) {
  if (file.endsWith(".DS_Store")) errors.push(`macOS metadata must not be published: ${relative(root, file)}`);
}

if (errors.length) {
  console.error(`Public dataset validation failed:\n${errors.join("\n")}`);
  process.exit(1);
}

console.log(
  `Public dataset validation passed: ${universe.moleculeCount} molecules, ${(factCatalog.molecules ?? []).length} referenced facts, ${(universe.galaxies ?? []).length} families.`
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hashDirectory(directory) {
  const hash = createHash("sha256");
  for (const file of listFiles(directory).sort()) {
    hash.update(relative(directory, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listFiles(directory, ignoredDirectories = new Set()) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path, ignoredDirectories));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
