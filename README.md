# Cuck Factory Bag Recycler V5 — embedded LI.FI concept

This V5 changes the flow from an external Jumper handoff to an embedded LI.FI swap widget.

## User flow

1. The value proposition is visible before any wallet action: leftover value becomes $CUCK **plus** extra Cuckdrop allocation.
2. Existing Employee wallet is supplied by the host site; test with `?wallet=0x...`.
3. If no Employee wallet is supplied, the prototype asks once for the Robinhood/EVM receiving address.
4. LI.FI Widget handles wallet connection, source chain/token selection, quote and execution inside the page.
5. Destination chain is locked to Robinhood Chain (chain ID 4663), destination token is locked to $CUCK, and destination address is preconfigured.
6. Widget route events update the top value strip live. On completed execution the page shows the received $CUCK, estimated extra Cuckdrop value and the hold rule.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. To simulate an already-known Employee receiving wallet:

```text
http://localhost:5173/?wallet=0xYOUR_EVM_WALLET
```

## Production integration points

- Replace the `wallet` query-param shim with the authenticated Employee Record wallet from cucks.money.
- Replace `CUCKDROP_USD_PER_CP = 0.015` in `src/config.js` with a live value from the Factory dashboard/allocation model.
- Persist the completed LI.FI route server-side and award Cuck Power exactly once.
- Store the exact amount of $CUCK received from that recycle and re-check the Employee wallet at the Cuckdrop snapshot. If balance is below the cumulative required recycled amount, remove the corresponding Recycling Cuck Power.
- Make cumulative tiering server-side: if a user moves from $5 total recycled to $25 total recycled, award only the difference between the 1,000 CP and 2,500 CP tier.
- Consider authenticated/private RPCs for production; public endpoints may rate-limit.

## Current prototype bonus ladder

| Cumulative recycled USD | Recycling CP |
|---:|---:|
| $1+ | 500 |
| $5+ | 1,000 |
| $25+ | 2,500 |
| $50+ | 3,500 |
| $100+ | 5,000 |
| $250+ | 7,500 |
| $500+ | 10,000 |

Prototype Cuckdrop estimate uses $0.015 per CP only to visualize the UX.

## Important

The page configures LI.FI Widget for EVM + Solana source ecosystems, Robinhood Chain as the only destination chain, $CUCK as the only destination token, and a fixed receiving wallet. Route availability still depends on LI.FI liquidity/routing for the selected source token.
