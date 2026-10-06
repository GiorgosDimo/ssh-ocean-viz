#!/bin/sh
# Installs git hooks from scripts/hooks/ into .git/hooks/.
# Run once after cloning: sh scripts/setup-hooks.sh
# Also runs automatically on: npm install (postinstall)

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repo"; exit 1; }
SRC="$REPO/scripts/hooks"
DEST="$REPO/.git/hooks"

for hook in "$SRC"/*; do
  name=$(basename "$hook")
  printf '#!/bin/sh\nexec "%s/%s" "$@"\n' "$SRC" "$name" > "$DEST/$name"
  chmod +x "$DEST/$name"
  echo "Installed: $name"
done
echo "Done."
