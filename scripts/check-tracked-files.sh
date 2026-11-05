#!/usr/bin/env bash
# Fails when Git tracks local data, private material or a key-like value. A pattern search
# cannot prove that a repository is free of secrets; it catches common mistakes.
set -u

status=0

forbidden=$(git ls-files | grep -E \
  -e '(^|/)\.env(\.[^/]+)?$' \
  -e '\.(db|sqlite|sqlite3|pem|key|crt|p12|pfx|mov|mp4|mp3|wav)$' \
  -e '(^|/)node_modules/' -e '(^|/)\.next/' -e '(^|/)\.venv/' -e '(^|/)out/' \
  -e '^backend/data/' -e '^demo/remotion/public/(footage|audio)/' \
  | grep -vE '(^|/)\.env\.example$')
if [ -n "$forbidden" ]; then
  echo "Tracked local or private files:"
  echo "$forbidden"
  status=1
fi

# The value after MODEL_API_KEY= must stay empty in tracked files.
secrets=$(git grep -nIE \
  -e 'sk-[A-Za-z0-9_-]{24,}' \
  -e 'BEGIN ([A-Z]+ )?PRIVATE KEY' \
  -e 'ghp_[A-Za-z0-9]{30,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '^MODEL_API_KEY=.+' \
  -- . ':!scripts/check-tracked-files.sh' ':!backend/uv.lock' ':!frontend/package-lock.json' ':!demo/remotion/package-lock.json')
if [ -n "$secrets" ]; then
  echo "Possible secrets in tracked files:"
  echo "$secrets" | cut -c1-120
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "No tracked local data or key-like values found."
fi
exit "$status"
