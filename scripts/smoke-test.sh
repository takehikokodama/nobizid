#!/usr/bin/env bash
# End-to-end smoke test for the nobizid (GBizID dummy OP) server.
# Usage: pnpm dev (in another terminal) && pnpm smoke-test
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:7999}"
CLIENT_ID="${GBIZID_CLIENT_ID:-local-client-id}"
CLIENT_SECRET="${GBIZID_CLIENT_SECRET:-local-client-secret}"
REDIRECT_URI="${GBIZID_REDIRECT_URI:-http://localhost:3000/callback}"
BASIC=$(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)

pass() { echo "OK   - $1"; }
fail() { echo "FAIL - $1"; exit 1; }

echo "== discovery =="
DISCOVERY=$(curl -sf "$BASE_URL/oauth/.well-known/openid-configuration")
echo "$DISCOVERY" | grep -q '"issuer"' && pass "discovery document served" || fail "discovery document"

echo "== authorize (scope omitted -> auto-expanded) =="
FORM=$(curl -sf "$BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$REDIRECT_URI'))")&response_type=code&state=s1&nonce=n1")
echo "$FORM" | grep -q 'name="scope" value="openid profile user mandate email offline_access jp_gbizid_v1_ida role delegation_info"' \
  && pass "default scope auto-expansion" || fail "default scope auto-expansion"

echo "== login (authorization_code flow) =="
LOCATION=$(curl -s -X POST "$BASE_URL/oauth/authorize" \
  --data-urlencode "state=s1" \
  --data-urlencode "nonce=n1" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "scope=openid profile email offline_access" \
  --data-urlencode "username=yamada" \
  --data-urlencode "password=password" \
  -D - -o /dev/null | grep -i '^location:' | tr -d '\r')
CODE=$(echo "$LOCATION" | sed -E 's/.*code=([^&]*)&.*/\1/')
[ ${#CODE} -eq 22 ] && pass "22-character authorization code issued" || fail "authorization code length"

echo "== token exchange =="
TOKEN_RESPONSE=$(curl -sf -X POST "$BASE_URL/oauth/token" \
  -H "Authorization: Basic $BASIC" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT_URI")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['refresh_token'])")
ID_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['id_token'])")

[ -n "$ACCESS_TOKEN" ] && pass "access_token issued" || fail "access_token missing"
[ -n "$REFRESH_TOKEN" ] && pass "refresh_token issued (offline_access requested)" || fail "refresh_token missing"

ID_TOKEN_PAYLOAD=$(python3 -c "
import base64, json, sys
payload = '$ID_TOKEN'.split('.')[1]
payload += '=' * (-len(payload) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(payload))))
")
echo "$ID_TOKEN_PAYLOAD" | grep -q '"email"' && fail "id_token must not contain personal info (email found)" \
  || pass "id_token contains no personal info"

echo "== userinfo =="
USERINFO=$(curl -sf "$BASE_URL/oauth/userinfo" -H "Authorization: Bearer $ACCESS_TOKEN")
echo "$USERINFO" | grep -q '"corporate_number"' && pass "profile scope claims present" || fail "profile scope claims"
echo "$USERINFO" | grep -q '"mandate_info"' && fail "mandate_info should be absent (mandate scope not requested)" \
  || pass "unrequested scope claims correctly absent"

echo "== refresh_token grant =="
REFRESHED=$(curl -sf -X POST "$BASE_URL/oauth/token" \
  -H "Authorization: Basic $BASIC" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN")
echo "$REFRESHED" | grep -q '"access_token"' && pass "refresh grant issued a new access_token" || fail "refresh grant"

echo "== rotated refresh_token can no longer be reused =="
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/oauth/token" \
  -H "Authorization: Basic $BASIC" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN")
[ "$STATUS" = "401" ] && pass "old refresh_token rejected (401)" || fail "old refresh_token should be rejected, got $STATUS"

echo "== error cases =="
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/oauth/token" \
  -H "Authorization: Basic $(printf '%s:wrong' "$CLIENT_ID" | base64)" \
  --data-urlencode "grant_type=authorization_code" --data-urlencode "code=x" --data-urlencode "redirect_uri=$REDIRECT_URI")
[ "$STATUS" = "401" ] && pass "bad client_secret rejected (401)" || fail "bad client_secret should be 401, got $STATUS"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/oauth/userinfo" -H "Authorization: Bearer garbage")
[ "$STATUS" = "401" ] && pass "bad bearer token rejected (401)" || fail "bad bearer token should be 401, got $STATUS"

echo
echo "All smoke tests passed."
