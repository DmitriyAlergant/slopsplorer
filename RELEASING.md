# Releasing Slopsplorer

## Prepare

1. Bump `version` in `package.json` and `package-lock.json`.
2. Rename `Unreleased` in `CHANGELOG.md` to the linked version and current date, then add a new empty `Unreleased` section above it.
3. Run `npm run typecheck`, `npm test`, `npm run build`, and `./scripts/changelog-section.sh X.Y.Z`.

## Take the screenshot

Use the current source through Vite, a light theme, a 1021 x 731 CSS-pixel viewport, no path filter, all regular flavors on, and Generated off.

For `docs/screenshot.png`, run `node --watch src/cli.ts vPREVIOUS --dev --no-open` and open the printed URL.
Collapse the commit band, select Diff, LOC, and Net, then capture the full viewport at the repository root.
Add a 1 CSS-pixel `#c7cbd3` border inside the image, which is 2 image pixels in the @2x asset, and keep the final image at 2042 x 1462 pixels.

The screenshot shows the repository-view control and the diff metrics in one frame.
The illustration in `docs/hero.jpg` is not a product screenshot and does not need release-by-release updates.

## Release

Commit the preparation on `dev`, rebase `dev` onto `origin/main`, force-push with lease, and open the pull request.
After it merges, tag that exact release commit as `vX.Y.Z` and push the tag.
The tag publishes npm and creates the GitHub release from the matching changelog section.
