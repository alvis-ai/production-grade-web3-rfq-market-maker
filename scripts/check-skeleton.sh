#!/usr/bin/env sh
set -eu

test -s package.json
test -s pnpm-workspace.yaml
test -s backend/src/main.ts
test -s backend/src/modules/quote/quote.service.ts
test -s backend/src/modules/execution/execution.service.ts
test -s backend/src/modules/inventory/inventory.service.ts
test -s backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/metrics/metrics.service.ts
test -s sdk/src/eip712.ts
test -s contracts/src/RFQSettlement.sol

grep -q 'server.post("/quote"' backend/src/main.ts
grep -q 'server.post("/submit"' backend/src/main.ts
grep -q 'server.get("/quote/:quoteId"' backend/src/main.ts
grep -q 'server.get("/metrics"' backend/src/main.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol

echo "skeleton check passed"
