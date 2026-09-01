# Releasing Slopsplorer

## Prepare

1. Bump `version` in `package.json` and `package-lock.json`.
2. Rename `Unreleased` in `CHANGELOG.md` to the linked version and current date, then add a new empty `Unreleased` section above it.
3. Run `npm run typecheck`, `npm test`, `npm run build`, and `./scripts/changelog-section.sh X.Y.Z`.

## Take the screenshot

Use the current source through Vite, a light theme, no path filter, all regular flavors on, and Generated off.
Clear `localStorage` first, because the workspace splitter position and the flavor filters restore from it.

For `docs/screenshot.png`, run `node --watch src/cli.ts vPREVIOUS --dev --no-open` and open the printed URL.
Set the viewport to 1440 CSS pixels wide at a device pixel ratio of 2.
The width must sit between two limits: `@media (max-width: 1100px)` stacks the two panels into one column, and `.app` stops widening at 1648 pixels and centers itself above that.
Collapse the commit band, select Diff, LOC, and Net, and stay at the repository root.
Capture the whole document rather than the viewport, because the page is taller than the viewport at this width.
Scale the capture to 2042 pixels wide, then draw a 1 CSS-pixel `#c7cbd3` border inside it, which is 2 image pixels in the @2x asset.
The height follows the document, so the asset is about 2042 x 1852 pixels.

The screenshot shows the repository-view control and the diff metrics in one frame.
The illustration in `docs/hero.jpg` is not a product screenshot and does not need release-by-release updates.

## Release

Commit the preparation on `dev`, rebase `dev` onto `origin/main`, force-push with lease, and open the pull request.
After it merges, tag that exact release commit as `vX.Y.Z` and push the tag.
The tag publishes npm and creates the GitHub release from the matching changelog section.
