<p align="center">
  <img src="public/icons/mga-icon-512.png" alt="Molecular Galaxy Atlas icon" width="180" />
</p>

[繁體中文](README.md) | **English**

# Molecular Galaxy Atlas

Molecular Galaxy Atlas (MGA) is an interactive 3D atlas of more than 3,000 real, source-tracked molecules arranged as ten chemical galaxies.

**Explore the atlas:** https://studio6-02.github.io/MGA-public/

## Public Data

Browser-ready molecule data is stored in `public/datasets/demo`. Every star with a featured fact displays a clickable `Reference: <source title>` link in its molecule card.

Approved featured facts and citations are also available in `data/molecule-facts.yml` for direct reading and human review. The complete research database, drafts, evidence collection, and internal review workflow remain in a separate private repository. See [DATA_SOURCES.md](DATA_SOURCES.md) for provenance and publication boundaries.

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
