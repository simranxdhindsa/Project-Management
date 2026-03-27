#!/usr/bin/env bash
# test_asana_integration.sh — end-to-end smoke test for the Asana PM integration
#
# Prerequisites:
#   - Backend running at $API_URL (default: http://localhost:8080/api)
#   - A valid user account with email/password set in TEST_EMAIL / TEST_PASSWORD
#   - Asana PAT and project ID configured in DB or env vars
#
# Usage:
#   TEST_EMAIL=you@example.com TEST_PASSWORD=secret ./scripts/test_asana_integration.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:8080/api}"
EMAIL="${TEST_EMAIL:-test@example.com}"
PASSWORD="${TEST_PASSWORD:-}"
PASS_COUNT=0
FAIL_COUNT=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS_COUNT++)); }
fail() { echo -e "${RED}✗${NC} $1"; ((FAIL_COUNT++)); }
info() { echo -e "${YELLOW}→${NC} $1"; }

# ── helpers ───────────────────────────────────────────────────────────────────

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command '$1' not found"; exit 1; }
}

http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

json_get() {
  curl -s "$@"
}

check_success() {
  local resp="$1"
  local label="$2"
  if echo "$resp" | grep -q '"success":true'; then
    pass "$label"
  else
    fail "$label — response: $(echo "$resp" | head -c 200)"
  fi
}

check_http() {
  local code="$1"
  local expected="$2"
  local label="$3"
  if [ "$code" = "$expected" ]; then
    pass "$label (HTTP $code)"
  else
    fail "$label (expected HTTP $expected, got $code)"
  fi
}

# ── Step 1: authenticate ──────────────────────────────────────────────────────

info "Checking API health…"
HEALTH=$(json_get "$API_URL/health")
check_success "$HEALTH" "API health check"

info "Authenticating…"
if [ -z "$PASSWORD" ]; then
  echo "Note: TEST_PASSWORD not set — skipping auth-required tests"
  JWT=""
else
  AUTH_RESP=$(json_get -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null || echo '{}')
  JWT=$(echo "$AUTH_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$JWT" ]; then
    pass "Authentication"
  else
    fail "Authentication — could not extract JWT"
    echo "Auth response: $AUTH_RESP"
    JWT=""
  fi
fi

AUTH_HEADER=""
[ -n "$JWT" ] && AUTH_HEADER="-H Authorization: Bearer $JWT"

# Shorthand authenticated curl
acurl() {
  if [ -n "$JWT" ]; then
    curl -s -H "Authorization: Bearer $JWT" "$@"
  else
    echo '{"_skipped":true}'
  fi
}

# ── Step 2: data source API ───────────────────────────────────────────────────

info "Testing user data source preference API…"

DS_GET=$(acurl "$API_URL/user/data-source")
if echo "$DS_GET" | grep -qE '"source":"(youtrack|asana)"'; then
  pass "GET /user/data-source returns valid source"
else
  fail "GET /user/data-source unexpected response: $DS_GET"
fi

DS_SET=$(acurl -X PUT "$API_URL/user/data-source" \
  -H "Content-Type: application/json" \
  -d '{"source":"asana"}')
check_success "$DS_SET" "PUT /user/data-source → asana"

DS_VERIFY=$(acurl "$API_URL/user/data-source")
if echo "$DS_VERIFY" | grep -q '"source":"asana"'; then
  pass "Data source persisted as asana"
else
  fail "Data source was not persisted: $DS_VERIFY"
fi

# ── Step 3: Asana PM status / metadata ───────────────────────────────────────

info "Testing Asana PM status endpoint…"
ASANA_STATUS=$(acurl "$API_URL/asana/pm/status")
if echo "$ASANA_STATUS" | grep -qE '"connected":|"configured":'; then
  pass "GET /asana/pm/status returns status object"
else
  fail "GET /asana/pm/status unexpected: $ASANA_STATUS"
fi

info "Testing Asana PM metadata endpoints…"
for ENDPOINT in states priorities users projects boards; do
  CODE=$(acurl -o /dev/null -w "%{http_code}" "$API_URL/asana/pm/$ENDPOINT")
  if [ "$CODE" = "200" ]; then
    pass "GET /asana/pm/$ENDPOINT → HTTP 200"
  else
    fail "GET /asana/pm/$ENDPOINT → HTTP $CODE (expected 200)"
  fi
done

# ── Step 4: Asana PM issues ───────────────────────────────────────────────────

info "Testing Asana PM issues endpoint…"
ISSUES=$(acurl "$API_URL/asana/pm/issues")
if echo "$ISSUES" | grep -q '"success":true'; then
  pass "GET /asana/pm/issues returns success"
  ISSUE_COUNT=$(echo "$ISSUES" | grep -o '"id":' | wc -l)
  info "  Found ~$ISSUE_COUNT issues"
else
  fail "GET /asana/pm/issues failed: $(echo "$ISSUES" | head -c 200)"
fi

info "Testing grouped-by-assignee…"
GROUPED=$(acurl "$API_URL/asana/pm/issues/grouped-by-assignee")
if echo "$GROUPED" | grep -q '"success":true'; then
  pass "GET /asana/pm/issues/grouped-by-assignee returns success"
else
  fail "GET /asana/pm/issues/grouped-by-assignee failed: $(echo "$GROUPED" | head -c 200)"
fi

# ── Step 5: Asana PM daily ops ────────────────────────────────────────────────

info "Testing Asana PM daily ops endpoints…"
for ENDPOINT in daily-brief eod-summary developer-load; do
  RESP=$(acurl "$API_URL/asana/pm/$ENDPOINT")
  if echo "$RESP" | grep -q '"success":true'; then
    pass "GET /asana/pm/$ENDPOINT"
  else
    fail "GET /asana/pm/$ENDPOINT failed: $(echo "$RESP" | head -c 200)"
  fi
done

info "Testing carryover endpoints…"
CARRYOVER=$(acurl "$API_URL/asana/pm/carryover")
if echo "$CARRYOVER" | grep -q '"success":true'; then
  pass "GET /asana/pm/carryover"
else
  fail "GET /asana/pm/carryover: $(echo "$CARRYOVER" | head -c 200)"
fi

# ── Step 6: pm-query (PM assistant) ──────────────────────────────────────────

info "Testing Asana PM Assistant…"
QUERY_RESP=$(acurl -X POST "$API_URL/asana/pm/pm-query" \
  -H "Content-Type: application/json" \
  -d '{"query":"How many open tasks are there?","history":[]}')
if echo "$QUERY_RESP" | grep -q '"response"'; then
  pass "POST /asana/pm/pm-query returns a response"
else
  fail "POST /asana/pm/pm-query failed: $(echo "$QUERY_RESP" | head -c 300)"
fi

# ── Step 7: response shape parity check ──────────────────────────────────────

info "Checking response shape parity with YouTrack endpoints…"

YT_BRIEF=$(acurl "$API_URL/youtrack/daily-brief")
AS_BRIEF=$(acurl "$API_URL/asana/pm/daily-brief")

for KEY in in_progress done blocked carryover; do
  YT_HAS=$(echo "$YT_BRIEF" | grep -c "\"$KEY\"" || true)
  AS_HAS=$(echo "$AS_BRIEF" | grep -c "\"$KEY\"" || true)
  if [ "$YT_HAS" -gt 0 ] && [ "$AS_HAS" -gt 0 ]; then
    pass "daily-brief has '$KEY' key in both sources"
  elif [ "$YT_HAS" -eq 0 ] && [ "$AS_HAS" -eq 0 ]; then
    info "  daily-brief '$KEY' key absent in both (may be empty data)"
  else
    fail "daily-brief '$KEY' key mismatch (yt:$YT_HAS asana:$AS_HAS)"
  fi
done

# ── Step 8: switch back to YouTrack ──────────────────────────────────────────

info "Switching back to YouTrack…"
SWITCH_BACK=$(acurl -X PUT "$API_URL/user/data-source" \
  -H "Content-Type: application/json" \
  -d '{"source":"youtrack"}')
check_success "$SWITCH_BACK" "PUT /user/data-source → youtrack"

YT_STATUS=$(acurl "$API_URL/youtrack/status")
if echo "$YT_STATUS" | grep -qE '"connected":|"configured":'; then
  pass "YouTrack still responds after switch back"
else
  fail "YouTrack status broken after switch: $YT_STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo -e "  ${GREEN}PASSED${NC}: $PASS_COUNT   ${RED}FAILED${NC}: $FAIL_COUNT"
echo "═══════════════════════════════════════"

[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
