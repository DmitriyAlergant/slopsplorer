#!/usr/bin/env bash
# Print the CHANGELOG.md section for one version, and fail when it is not there.
#
# This is the guard that the Towncrier build used to be: a release must not go
# out with a changelog that was never versioned. The release workflow runs it
# twice, once before `npm publish`, which is permanent, and once to write the
# GitHub release notes from the same text. Run it yourself before you tag.
set -euo pipefail

version="${1:?usage: changelog-section.sh <version>}"
changelog="$(dirname "$0")/../CHANGELOG.md"

# `index(...) == 1` rather than a match, so the version needs no regex escaping.
section="$(awk -v version="$version" '
  index($0, "## [" version "]") == 1 { inside = 1; print; next }
  inside && index($0, "## [") == 1 { exit }
  inside { print }
' "$changelog")"

if [ -z "$section" ]; then
  echo "CHANGELOG.md holds no '## [$version]' section." >&2
  echo "Rename the Unreleased heading to this version before you tag it." >&2
  exit 1
fi

# A heading with nothing under it is a release that says nothing.
if [ -z "$(printf '%s\n' "$section" | tail -n +2 | tr -d '[:space:]')" ]; then
  echo "The '## [$version]' section of CHANGELOG.md is empty." >&2
  exit 1
fi

printf '%s\n' "$section"
