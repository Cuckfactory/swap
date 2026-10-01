# Cuck Factory Bag Recycler — V2 prototype

This revision intentionally removes almost all user input and the main transaction-proof step.

## Production flow
1. cucks.money recognizes the active Employee session and loads the registered Robinhood Chain wallet.
2. If no Employee is recognized, the user must log in or create an Employee Record first. No receiving-wallet field is shown on the recycler page.
3. When `RECYCLE MY BAG` is clicked, production should store the Employee wallet's current $CUCK balance and a recycle-session timestamp server-side.
4. Jumper opens with Robinhood Chain, the official $CUCK contract and the Employee wallet as the destination.
5. The user connects whichever source wallet actually holds the old bag. Source wallet may differ from the receiving wallet.
6. After the user returns, cucks.money checks the registered wallet automatically. Any new $CUCK received since the recycle session is the candidate recycled amount.
7. Production awards the cumulative Recycling Cuck Power tier and stores the exact $CUCK amount as the required hold.
8. At Cuckdrop snapshot, wallet balance must be at least the required recycled-$CUCK hold or the Recycling Cuck Power is removed.

## Fallback
If automatic wallet detection fails, users may paste the source transaction Jumper gave them. The prototype follows `https://li.quest/v1/status?txHash=...` so production can resolve a source-chain transaction into the destination transaction. Users should never need to manually find the Robinhood transaction.

## Bonus tiers
- $1+: 500 CP
- $5+: 1,000 CP
- $25+: 2,500 CP
- $50+: 3,500 CP
- $100+: 5,000 CP
- $250+: 7,500 CP
- $500+: 10,000 CP max

Production should calculate tiers cumulatively per Employee and pull the live Cuckdrop value-per-CP from the existing dashboard rather than the prototype estimate.

## Current constants
- Robinhood Chain ID: 4663
- $CUCK contract: `0x7648f37c2314466726a28f7a5edbdb8dc7b3e23f`

## Prototype test states
- Default: demo Employee is recognized.
- Add `?guest=1` to the URL to preview the not-logged-in state.
- Press `Alt+D` to simulate a successful ~$100 recycle result.
