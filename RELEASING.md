# Releasing Slopsplorer

## Prepare

1. Bump `version` in `package.json` and `package-lock.json`.
2. Rename `Unreleased` in `CHANGELOG.md` to the linked version and current date, then add a new empty `Unreleased` section above it.
3. Run `npm run typecheck`, `npm test`, `npm run build`, and `./scripts/changelog-section.sh X.Y.Z`.

## Take the screenshots

Use the current source through Vite, a light theme, a 1460 x 1080 CSS-pixel viewport, no path filter, all regular flavors on, and Generated off.

For `docs/screenshot.png`, run `npm run dev -- --no-open`, open the printed URL, and capture the full viewport at the repository root in Tokens.

For `docs/screenshot-diff.png`, run `node --watch src/cli.ts vPREVIOUS --dev --no-open`, open the printed URL, collapse the commit band, select Net and Tokens, and capture the full viewport at the repository root.

Keep both screenshots while scan and diff mode have different controls and metrics.
The illustration in `docs/hero.jpg` is not a product screenshot and does not need release-by-release updates.

## Release

Commit the preparation on `dev`, rebase `dev` onto `origin/main`, force-push with lease, and open the pull request.
After it merges, tag that exact release commit as `vX.Y.Z` and push the tag.
The tag publishes npm and creates the GitHub release from the matching changelog section.
