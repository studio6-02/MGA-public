export function moleculeBadges(molecule) {
  const provenance =
    molecule.recordType === "reference"
      ? { label: "Reference", tone: "verified" }
      : { label: "Visual density", tone: "pending" };
  const fact = molecule.factSourceUrl
    ? { label: "Fact sourced", tone: "verified" }
    : { label: "Fact pending", tone: "pending" };

  return [provenance, fact];
}

export function factReference(molecule) {
  const title = String(molecule.factSourceTitle ?? "").trim();
  const href = String(molecule.factSourceUrl ?? "").trim();

  if (!title || !isHttpUrl(href)) return null;

  return {
    href,
    label: `Reference: ${title}`,
    title: `Open reference: ${title}`
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
