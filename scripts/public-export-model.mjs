const PUBLIC_FACT_FIELDS = [
  "molecule_id",
  "name",
  "galaxy",
  "fact_id",
  "category",
  "fact",
  "source_title",
  "source_organization",
  "source_url",
  "verification_status"
];

export function buildPublicFactCatalog(factsModel) {
  const molecules = [];

  for (const molecule of factsModel.molecules ?? []) {
    for (const fact of molecule.facts ?? []) {
      if (fact.featured !== true || fact.verification_status === "draft") continue;
      assertPublicFact(molecule, fact);
      molecules.push({
        molecule_id: molecule.molecule_id,
        name: molecule.name,
        galaxy: molecule.galaxy,
        fact_id: fact.id,
        category: fact.category,
        fact: fact.text_zh_tw,
        source_title: fact.source_title,
        source_organization: fact.source_organization,
        source_url: fact.source_url,
        verification_status: fact.verification_status
      });
    }
  }

  return { molecules };
}

function assertPublicFact(molecule, fact) {
  const label = fact.id || molecule.name || molecule.molecule_id || "Featured fact";
  for (const field of ["id", "category", "text_zh_tw", "source_title", "source_organization", "source_url"]) {
    if (!String(fact[field] ?? "").trim()) throw new Error(`${label} is missing ${field}.`);
  }

  try {
    const source = new URL(fact.source_url);
    if (source.protocol !== "http:" && source.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${label} requires a valid HTTP source_url.`);
  }
}

export function serializePublicFactCatalog(catalog) {
  const lines = [
    "_schema:",
    "  description: Published Molecular Galaxy Atlas featured facts",
    "  version: 1",
    "molecules:"
  ];

  for (const molecule of catalog.molecules ?? []) {
    lines.push(`- molecule_id: ${yamlValue(molecule.molecule_id)}`);
    for (const field of PUBLIC_FACT_FIELDS.slice(1)) {
      lines.push(`  ${field}: ${yamlValue(molecule[field])}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function validatePublicRuntime({ universe, galaxies, factCatalog }) {
  const errors = [];
  const molecules = (galaxies ?? []).flatMap((galaxy) => galaxy.molecules ?? []);
  const runtimeFacts = molecules.filter((molecule) => molecule.fact);
  const factsByMoleculeId = new Map((factCatalog?.molecules ?? []).map((fact) => [fact.molecule_id, fact]));

  if (Number(universe?.moleculeCount) !== molecules.length) {
    errors.push(`Universe moleculeCount is ${universe?.moleculeCount}; runtime contains ${molecules.length}.`);
  }
  if (Number(universe?.referenceCount) !== molecules.length) {
    errors.push(`Universe referenceCount is ${universe?.referenceCount}; runtime contains ${molecules.length}.`);
  }
  if (Number(universe?.generatedDemoCount) !== 0) {
    errors.push(`Public runtime must contain 0 generated demo molecules; found ${universe?.generatedDemoCount}.`);
  }

  const summaries = new Map((universe?.galaxies ?? []).map((galaxy) => [galaxy.id, galaxy]));
  for (const galaxy of galaxies ?? []) {
    const summary = summaries.get(galaxy.id);
    if (!summary) errors.push(`Runtime galaxy ${galaxy.id} is missing from universe.json.`);
    if (summary && Number(summary.moleculeCount) !== (galaxy.molecules ?? []).length) {
      errors.push(`${galaxy.id} molecule count does not match universe.json.`);
    }
  }

  for (const molecule of molecules) {
    if (molecule.recordType !== "reference") errors.push(`${molecule.id} is not a reference molecule.`);
    if (!molecule.fact) continue;
    if (!molecule.factSourceTitle) errors.push(`${molecule.id} fact is missing factSourceTitle.`);
    if (!isHttpUrl(molecule.factSourceUrl)) errors.push(`${molecule.id} fact requires an HTTP factSourceUrl.`);

    const catalogFact = factsByMoleculeId.get(molecule.id);
    if (!catalogFact) {
      errors.push(`${molecule.id} fact is missing from the public fact catalog.`);
      continue;
    }
    if (catalogFact.fact !== molecule.fact) errors.push(`${molecule.id} fact text differs from the public catalog.`);
    if (catalogFact.source_title !== molecule.factSourceTitle) {
      errors.push(`${molecule.id} fact source title differs from the public catalog.`);
    }
    if (catalogFact.source_url !== molecule.factSourceUrl) {
      errors.push(`${molecule.id} fact source URL differs from the public catalog.`);
    }
  }

  if ((factCatalog?.molecules ?? []).length !== runtimeFacts.length) {
    errors.push(
      `Public fact catalog contains ${(factCatalog?.molecules ?? []).length} facts; runtime contains ${runtimeFacts.length}.`
    );
  }

  return errors;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function yamlValue(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value ?? ""));
}
