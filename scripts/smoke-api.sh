#!/usr/bin/env sh
set -eu

API_URL="${API_URL:-http://127.0.0.1:3000}"

echo "GET ${API_URL}/health"
curl -fsS "${API_URL}/health"
echo

echo "POST ${API_URL}/quote using examples/quote-request.json"
curl -fsS \
  -H "content-type: application/json" \
  --data @examples/quote-request.json \
  "${API_URL}/quote"
echo

echo "POST ${API_URL}/submit using examples/submit-request.json"
curl -fsS \
  -H "content-type: application/json" \
  --data @examples/submit-request.json \
  "${API_URL}/submit"
echo

echo "GET ${API_URL}/metrics"
curl -fsS "${API_URL}/metrics"
echo
