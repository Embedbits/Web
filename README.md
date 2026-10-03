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

The sidebar follows the hierarchical repository names: `Bsp-Mcal-Exti` is the module Exti of the Mcal layer of
the Bsp layer and ends up in `docs/bsp/mcal/exti.md`. Name segments without a repository of their own become plain
categories. Naming exceptions (`EmBi_Platform`, `EmBi-ArtifactsHandler`, `Artifact-*` below `Artifacts`) and labels
are configured at the top of `scripts/sync-docs.mjs`.

- A repository that has children (further repositories below its name or further `README.md` files in its tree)
  becomes an expandable sidebar item and the others are listed beneath it.
- Repositories keep one branch per STM32 family (`STM32G4`, `STM32H5`, ...). Each page starts with the families the
  repository supports and the ones it does not, and layer pages (e.g. MCAL) get a family support table.
- Needs the GitHub API (`GITHUB_TOKEN` is provided in CI) and `git`. If anything cannot be loaded the sync is
  skipped and the committed pages stay as they are.

```bash
npm run sync-docs
```

- Every new repository that has a README gets a page automatically, placed by its name.
- Custom positions, labels and titles are configured at the top of `scripts/sync-docs.mjs`.
- Pages of deleted, archived or README-less repositories are removed.
- The deploy workflow runs the sync before every build: on push to `main`, daily, manually, and on
  `repository_dispatch` of type `docs-updated`.

## Contact form

The Contact page sends messages through [Web3Forms](https://web3forms.com), so the owner's e-mail address is not on
the website. Spam protection: a hidden honeypot field and Cloudflare Turnstile.

1. Create a Web3Forms access key for the receiving address and, in its dashboard, enable Cloudflare Turnstile
   with the secret key of a Turnstile widget for the site's domain.
2. Fill in `customFields.contactForm` in `docusaurus.config.ts` (`web3formsAccessKey`, `turnstileSiteKey`).
   Both values are public by design; restrict the access key to the domain in the Web3Forms dashboard.

While `web3formsAccessKey` is empty, the page shows the plain e-mail link instead of the form.
