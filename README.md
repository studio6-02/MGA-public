<p align="center">
  <img src="public/icons/mga-icon-512.png" alt="Molecular Galaxy Atlas icon" width="180" />
</p>

# Molecular Galaxy Atlas

Molecular Galaxy Atlas (MGA) is a static 3D atlas of real, source-tracked molecules arranged as ten chemical galaxies.

**Explore the atlas:** https://studio6-02.github.io/MGA-public/

## Public Data

The browser-ready molecule tiles are stored in `public/datasets/demo`. Approved featured facts and their reference links are also available in `data/molecule-facts.yml` for human review.

The canonical research database, drafts, evidence collection, and review workflow live in a separate private repository. Browser-visible facts and citations are intentionally public. See [DATA_SOURCES.md](DATA_SOURCES.md) for provenance and publication boundaries.

## Run Locally

```bash
npm ci
npm run validate:public
npm run dev
```

## Build

```bash
npm run build
```

Every push to `main` validates the public dataset and deploys the resulting `dist/` directory through GitHub Pages Actions.
