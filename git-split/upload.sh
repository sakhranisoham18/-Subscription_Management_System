#!/usr/bin/env bash
# Usage (run from the root of the extracted project folder):
#   bash git-split/upload.sh <member-number 1-4> <github-repo-url>
# Member 1 must run first (creates main). Members 2-4 then push their own branch and open a PR.
set -euo pipefail
M="${1:?member number 1-4}"; URL="${2:?github repo url}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SRC="$(pwd)"
MAN="$HERE/member$M.manifest"; [ -f "$MAN" ] || { echo "no manifest for member $M"; exit 1; }
FIRST="$(head -1 "$MAN" | cut -d"|" -f2)"; [ -f "$SRC/$FIRST" ] || { echo "run this from the extracted project folder"; exit 1; }
WORK="$(mktemp -d)"
if [ "$M" = "1" ]; then
  git init -q -b main "$WORK"; git -C "$WORK" remote add origin "$URL"; BR=main
else
  git clone -q "$URL" "$WORK"; BR="feature/member$M"; git -C "$WORK" checkout -q -b "$BR"
fi
prev=""
commit_group() {
  [ -n "$prev" ] || return 0
  git -C "$WORK" add -A
  git -C "$WORK" diff --cached --quiet || git -C "$WORK" commit -q -m "member$M: ${prev#*-} (${prev%%-*})"
}
while IFS='|' read -r g f; do
  [ "$g" = "$prev" ] || { commit_group; prev="$g"; }
  mkdir -p "$WORK/$(dirname "$f")"; cp "$SRC/$f" "$WORK/$f"
done < <(sort "$MAN")
commit_group
git -C "$WORK" push -u origin "$BR"
if [ "$M" != "1" ] && command -v gh >/dev/null; then
  (cd "$WORK" && gh pr create --base main --head "$BR" --title "Member $M: my part of Brightloop" --body "Files listed in git-split/member$M.manifest" || true)
fi
echo "Done. Work copy: $WORK"
