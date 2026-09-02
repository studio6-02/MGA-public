# Data Sources

## Molecules

Phase 1 molecule identities and properties are sourced primarily from PubChem. Each runtime molecule carries a PubChem CID from which the application links to the corresponding compound record.

- PubChem: https://pubchem.ncbi.nlm.nih.gov/
- PubChem PUG REST: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest

The public release contains only real `reference` molecules. Generated visual-density placeholders are not part of the Phase 1 public dataset.

## Featured Facts

Every displayed fact includes a source title and a direct HTTP(S) reference URL. The molecule card shows this as `Reference: <source title>`. The sanitized public catalog is stored in `data/molecule-facts.yml`.

The public catalog excludes drafts, reviewer identities, internal comments, evidence caches, candidate queues, and migration records. Publication counts and a dataset checksum are recorded in `release-manifest.json`.

## Verification Scope

`expert_reviewed` records have completed the MGA human review workflow. Citations support the featured statement but do not imply endorsement by the cited publisher. Molecular Galaxy Atlas is an educational visualization and not medical advice.
