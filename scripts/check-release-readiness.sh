#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FAILURES=0

pass() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  if [ "${2:-}" != "" ]; then
    echo "       ${2}"
  fi
  FAILURES=$((FAILURES + 1))
}

json_version() {
  bun -e 'const file = process.argv[1]; const pkg = JSON.parse(await Bun.file(file).text()); console.log(pkg.version);' "$1"
}

json_script() {
  bun -e 'const file = process.argv[1]; const script = process.argv[2]; const pkg = JSON.parse(await Bun.file(file).text()); console.log(pkg.scripts?.[script] ?? "");' "$1" "$2"
}

check_package_version() {
  local relative_path="$1"
  local absolute_path="$REPO_ROOT/$relative_path"
  local expected_version="$2"

  if [ ! -f "$absolute_path" ]; then
    fail "$relative_path exists" "missing file: $relative_path"
    return
  fi

  local actual_version
  actual_version="$(json_version "$absolute_path")"
  if [ "$actual_version" = "$expected_version" ]; then
    pass "$relative_path version: $actual_version"
  else
    fail "$relative_path version matches root package.json" "expected $expected_version, got $actual_version"
  fi
}

check_env_migrations_dir() {
  local env_name="$1"
  local expected_dir="drizzle/migrations"
  local actual_dir

  actual_dir="$(
    bun -e '
      const file = process.argv[1];
      const envName = process.argv[2];
      const text = await Bun.file(file).text();
      const header = `[[env.${envName}.d1_databases]]`;
      const start = text.indexOf(header);
      const rest = start === -1 ? "" : text.slice(start + header.length);
      const next = rest.search(/\n\[\[|\n\[env\./);
      const block = next === -1 ? rest : rest.slice(0, next);
      const dir = block.match(/^\s*migrations_dir\s*=\s*"([^"]+)"/m)?.[1] ?? "";
      console.log(dir);
    ' "$WRANGLER_FILE" "$env_name"
  )"

  if [ "$actual_dir" = "$expected_dir" ]; then
    pass "wrangler.toml env.$env_name D1 migrations_dir: $actual_dir"
  else
    fail "wrangler.toml env.$env_name D1 migrations_dir" "expected $expected_dir, got ${actual_dir:-<missing>}"
  fi
}

check_deploy_workflow_gate() {
  local relative_path="$1"
  local deploy_script="$2"
  local workflow_file="$REPO_ROOT/$relative_path"
  local gate_line
  local deploy_line

  if [ ! -f "$workflow_file" ]; then
    fail "$relative_path exists" "missing file: $relative_path"
    return
  fi

  gate_line="$(grep -n "bun run check:release" "$workflow_file" | head -n 1 | cut -d: -f1 || true)"
  deploy_line="$(grep -n "bun run ${deploy_script}" "$workflow_file" | head -n 1 | cut -d: -f1 || true)"

  if [ -z "$deploy_line" ]; then
    fail "$relative_path runs $deploy_script" "missing deploy command: bun run $deploy_script"
    return
  fi

  if [ -n "$gate_line" ] && [ "$gate_line" -lt "$deploy_line" ]; then
    pass "$relative_path gates $deploy_script with check:release"
  else
    fail "$relative_path gates $deploy_script with check:release" "check:release must run before bun run $deploy_script"
  fi
}

check_public_read_perf_script() {
  local script_name="$1"
  local expected_mode="$2"
  local label="$3"
  local script

  script="$(json_script "$ROOT_PACKAGE_JSON" "$script_name")"
  if [ -z "$script" ]; then
    fail "$label" "missing script $script_name"
    return
  fi

  if [[ "$script" == *"scripts/public-read-performance.ts"* && "$script" == *"--mode ${expected_mode}"* ]]; then
    pass "$label"
  else
    fail "$label" "expected $script_name to run scripts/public-read-performance.ts --mode ${expected_mode}, got $script"
  fi
}

ROOT_PACKAGE_JSON="$REPO_ROOT/package.json"
CHANGELOG_FILE="$REPO_ROOT/CHANGELOG.md"
API_VERSION_FILE="$REPO_ROOT/apps/api/src/version.ts"
WRANGLER_FILE="$REPO_ROOT/apps/api/wrangler.toml"
API_PACKAGE_JSON="$REPO_ROOT/apps/api/package.json"
PRODUCTION_ENV="production"

if [ ! -f "$ROOT_PACKAGE_JSON" ]; then
  fail "package.json exists" "missing file: package.json"
  echo
  echo "Release readiness: NO-GO"
  exit 1
fi

ROOT_VERSION="$(json_version "$ROOT_PACKAGE_JSON")"
pass "package.json version: $ROOT_VERSION"

check_public_read_perf_script "perf:public-read:local" "local" "package.json wires local public read perf proof"
check_public_read_perf_script "perf:public-read:remote" "remote" "package.json wires deployed public read perf proof"

check_package_version "apps/admin/package.json" "$ROOT_VERSION"
check_package_version "apps/api/package.json" "$ROOT_VERSION"
check_package_version "packages/schemas/package.json" "$ROOT_VERSION"

if [ -f "$API_VERSION_FILE" ]; then
  API_VERSION="$(sed -n "s/.*API_VERSION = '\\([^']*\\)'.*/\\1/p" "$API_VERSION_FILE" | head -n 1)"
  if [ "$API_VERSION" = "$ROOT_VERSION" ]; then
    pass "apps/api/src/version.ts matches package.json: $API_VERSION"
  else
    fail "apps/api/src/version.ts matches package.json" "expected $ROOT_VERSION, got ${API_VERSION:-<missing>}"
  fi
else
  fail "apps/api/src/version.ts exists" "missing file: apps/api/src/version.ts"
fi

if [ -f "$CHANGELOG_FILE" ]; then
  if grep -q -F "## [Unreleased]" "$CHANGELOG_FILE"; then
    pass "CHANGELOG.md keeps an [Unreleased] section"
  else
    fail "CHANGELOG.md keeps an [Unreleased] section" "missing heading: ## [Unreleased]"
  fi

  if grep -q -F "## [$ROOT_VERSION]" "$CHANGELOG_FILE"; then
    pass "CHANGELOG.md contains release entry for $ROOT_VERSION"
  else
    fail "CHANGELOG.md contains release entry for $ROOT_VERSION" "missing heading: ## [$ROOT_VERSION]"
  fi
else
  fail "CHANGELOG.md exists" "missing file: CHANGELOG.md"
fi

if [ -f "$WRANGLER_FILE" ]; then
  PLACEHOLDER_MATCHES="$(grep -n -E "STAGING_DATABASE_ID|STAGING_KV_NAMESPACE_ID|PRODUCTION_DATABASE_ID|PRODUCTION_KV_NAMESPACE_ID" "$WRANGLER_FILE" || true)"
  if [ -z "$PLACEHOLDER_MATCHES" ]; then
    pass "wrangler.toml Cloudflare binding placeholders removed"
  else
    fail "wrangler.toml Cloudflare binding placeholders removed" "$PLACEHOLDER_MATCHES"
  fi

  if grep -q -E "^\[env\.${PRODUCTION_ENV}\]" "$WRANGLER_FILE"; then
    pass "wrangler.toml defines production environment: $PRODUCTION_ENV"
  else
    fail "wrangler.toml defines production environment: $PRODUCTION_ENV" "missing [env.${PRODUCTION_ENV}]"
  fi

  check_env_migrations_dir "staging"
  check_env_migrations_dir "$PRODUCTION_ENV"
else
  fail "apps/api/wrangler.toml exists" "missing file: apps/api/wrangler.toml"
fi

if [ -f "$API_PACKAGE_JSON" ]; then
  DEPLOY_PRODUCTION_SCRIPT="$(json_script "$API_PACKAGE_JSON" "deploy:production")"
  if [[ "$DEPLOY_PRODUCTION_SCRIPT" == *"--env ${PRODUCTION_ENV}"* ]]; then
    pass "apps/api deploy:production targets env: $PRODUCTION_ENV"
  else
    fail "apps/api deploy:production targets env: $PRODUCTION_ENV" "got ${DEPLOY_PRODUCTION_SCRIPT:-<missing>}"
  fi
else
  fail "apps/api/package.json exists" "missing file: apps/api/package.json"
fi

check_deploy_workflow_gate ".github/workflows/deploy-staging.yml" "deploy:staging"
check_deploy_workflow_gate ".github/workflows/deploy-production.yml" "deploy:production"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "Release readiness: GO"
  exit 0
fi

echo "Release readiness: NO-GO"
exit 1
