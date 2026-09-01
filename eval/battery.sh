#!/usr/bin/env bash
# Runs the full eval battery, one --case invocation at a time so each project
# gets its own MCP server. Logs to eval/results/battery-<ts>.log
set -u
cd "$(dirname "$0")"

HOTEL=/Applications/XAMPP/xamppfiles/htdocs/hotel/api
LOAN=/Users/pitersonsmartpro/RiderProjects/LoanApp

HOTEL_CASES="cases/01-reservation-endpoints.json cases/02-checkin-flow.json cases/03-permission-roles.json cases/04-pricing-calculation.json cases/05-db-schema.json cases/06-housekeeping-relation.json cases/07-pm-simple-booking.json cases/08-pm-booking-failure.json cases/09-pm-permission-implicit.json cases/11-pm-housekeeping-implicit.json cases/15-pm-real-data-hotel.json cases/17-pm-housekeeping-bug.json cases/18-conversation-push-limits.json"
LOAN_CASES="cases/12-loanapp-simple.json cases/13-loanapp-disbursement-pm.json cases/14-loanapp-conversation.json cases/19-loanapp-money-stuck.json"

for c in $HOTEL_CASES; do
  echo "=== HOTEL $c ==="
  # A case every ~75s: back-to-back agents trip Vertex's per-minute quota and a
  # 429 costs the whole case, which is worse than a slower battery.
  sleep 75
  npx tsx run.ts --case="$c" --project="$HOTEL" || true
done

for c in $LOAN_CASES; do
  echo "=== LOAN $c ==="
  sleep 75
  npx tsx run.ts --case="$c" --project="$LOAN" || true
done
echo "=== BATTERY DONE ==="
