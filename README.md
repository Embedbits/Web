# Embedbits Web

Source of the [Embedbits](https://github.com/Embedbits) website, built with [Docusaurus](https://docusaurus.io/).

## Installation

```bash
npm install
```

**Note**: feel free to use the package manager of your choice.

## Local Development

```bash
npm run start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

The site is deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

## Documentation sync

Pages under `docs/platform`, `docs/bsp` and `docs/artifacts` are generated from the `README.md` of the
repositories in the [Embedbits organization](https://github.com/Embedbits). Do not edit them by hand.

```bash
npm run sync-docs
```

- New repositories named `Bsp-Mcal-*`, `Bsp-Ral-*` or `Artifact-*` that have a README get a page automatically.
- Other repositories (or custom titles/positions) are configured in `KNOWN_PAGES` in `scripts/sync-docs.mjs`.
- Pages of deleted, archived or README-less repositories are removed.
- The deploy workflow runs the sync before every build: on push to `main`, daily, manually, and on
  `repository_dispatch` of type `docs-updated`.
