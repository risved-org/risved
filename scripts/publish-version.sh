#!/usr/bin/env bash
# Pin the control plane version on risved.com after a release.
#
# Called from .github/workflows/release.yml once the Docker image for a
# v<version> tag has been pushed. Rewrites static/version.json in the
# risved-org/risved.com repo through the GitHub contents API so the
# self-update check (which polls https://risved.com/version.json) sees the
# new version. Release notes are the commit subjects since the previous tag.
#
# Usage: TAG=v0.18.9 GH_TOKEN=<token with contents:write on risved.com> scripts/publish-version.sh
#   DRY_RUN=1 prints the manifest instead of pushing it.
set -euo pipefail

TAG="${TAG:-${GITHUB_REF_NAME:-}}"
REPO="${RISVED_COM_REPO:-risved-org/risved.com}"
FILE="static/version.json"

[ -n "$TAG" ] || { echo "TAG is required (e.g. v0.18.9)" >&2; exit 1; }
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN is not set — add the RISVED_COM_TOKEN secret to the repo" >&2; exit 1; }

VERSION="${TAG#v}"
case "$VERSION" in
	*-*) echo "Pre-release tag $TAG, not publishing"; exit 0 ;;
esac
# The workflow fires on every v* tag, so a name like vbanana reaches this far.
# Refuse it rather than pinning a version.json the self-update cannot parse.
if ! printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
	echo "$TAG is not a vX.Y.Z release tag, not publishing" >&2
	exit 1
fi

# Release notes: commit subjects since the previous release tag, minus the
# version bumps and merges, with conventional-commit prefixes stripped.
PREV=$(git describe --tags --abbrev=0 --match 'v*' "${TAG}^" 2>/dev/null || true)
RANGE="${PREV:+$PREV..}$TAG"
# The grep needs `|| true`: when every commit in the range is a version bump it
# matches nothing and exits 1, which under pipefail would kill the script here
# instead of letting the fallback below set the notes.
NOTES=$(git log --format='%s' --no-merges "$RANGE" \
	| { grep -viE '^(bump version|chore: (bump|release))' || true; } \
	| sed -E 's/^(build|chore|ci|docs|feat|fix|perf|refactor|style|test)(\([^)]*\))?!?: //' \
	| awk '{ sub(/[[:space:].]+$/, ""); print toupper(substr($0, 1, 1)) substr($0, 2) "." }' \
	| paste -sd ' ' -)
[ -n "$NOTES" ] || NOTES="Release $VERSION."

CURRENT=$(gh api "repos/$REPO/contents/$FILE?ref=main")
CURRENT_SHA=$(jq -r '.sha' <<<"$CURRENT")
CURRENT_JSON=$(jq -r '.content' <<<"$CURRENT" | tr -d '\n' | base64 --decode)
CURRENT_VERSION=$(jq -r '.version' <<<"$CURRENT_JSON")
MIN_VERSION=$(jq -r '.minVersion // "0.1.0"' <<<"$CURRENT_JSON")

# Never move the pin backwards (re-tagged older release, out-of-order runs)
NEWEST=$(printf '%s\n%s\n' "$CURRENT_VERSION" "$VERSION" | sort -V | tail -1)
if [ "$VERSION" = "$CURRENT_VERSION" ] || [ "$NEWEST" != "$VERSION" ]; then
	echo "risved.com already pins $CURRENT_VERSION, not changing it to $VERSION"
	exit 0
fi

MANIFEST=$(jq --tab -n --arg v "$VERSION" --arg n "$NOTES" --arg m "$MIN_VERSION" \
	'{ version: $v, releaseNotes: $n, minVersion: $m }')

if [ "${DRY_RUN:-}" = "1" ]; then
	echo "Would pin $CURRENT_VERSION -> $VERSION on $REPO:"
	echo "$MANIFEST"
	exit 0
fi

gh api -X PUT "repos/$REPO/contents/$FILE" \
	-f message="chore: pin control plane download to $VERSION" \
	-f branch=main \
	-f sha="$CURRENT_SHA" \
	-f content="$(printf '%s\n' "$MANIFEST" | base64 | tr -d '\n')" \
	--jq '.commit.html_url'
echo "Pinned $CURRENT_VERSION -> $VERSION"
