#!/usr/bin/env bash
# Rerun of the quota-depleted and not-yet-reached cases from battery3, with the
# 75s spacing that battery.sh now has.
set -u
cd "$(dirname "$0")"

HOTEL=/Applications/XAMPP/xamppfiles/htdocs/hotel/api
LOAN=/Users/pitersonsmartpro/RiderProjects/LoanApp

RERUN="cases/01-reservation-endpoints.json cases/04-pricing-calculation.json cases/06-housekeeping-relation.json cases/07-pm-simple-booking.json cases/08-pm-booking-failure.json cases/09-pm-permission-implicit.json cases/11-pm-housekeeping-implicit.json cases/15-pm-real-data-hotel.json cases/17-pm-housekeeping-bug.json cases/18-conversation-push-limits.json"
LOAN_CASES="cases/12-loanapp-simple.json cases/13-loanapp-disbursement-pm.json cases/14-loanapp-conversation.json cases/19-loanapp-money-stuck.json"

for c in $RERUN; do
  echo "=== HOTEL $c ==="
  sleep 75
  npx tsx run.ts --case="$c" --project="$HOTEL" || true
done

for c in $LOAN_CASES; do
  echo "=== LOAN $c ==="
  sleep 75
  npx tsx run.ts --case="$c" --project="$LOAN" || true
done
echo "=== RERUN DONE ==="
