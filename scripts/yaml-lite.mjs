export function parseYamlLite(text) {
  const root = {};
  let currentSection = null;
  let currentItem = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = /^([A-Za-z0-9_-]+):\s*$/.exec(trimmed);
    if (sectionMatch && !line.startsWith(" ")) {
      currentSection = sectionMatch[1];
      root[currentSection] = [];
      currentItem = null;
      continue;
    }

    if (!currentSection) continue;

    if (trimmed.startsWith("- ")) {
      currentItem = {};
      root[currentSection].push(currentItem);
      assignPair(currentItem, trimmed.slice(2));
      continue;
    }

    if (currentItem && /^\s+[A-Za-z0-9_-]+:/.test(line)) {
      assignPair(currentItem, trimmed);
    }
  }

  return root;
}

function assignPair(target, pair) {
  const index = pair.indexOf(":");
  if (index === -1) return;
  const key = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  target[key] = coerceValue(value);
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "''" || value === '""') return "";
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
