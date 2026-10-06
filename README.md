# Cuck Factory Bag Recycler V8

Prototype for the CUCK dead-bag recycling growth loop.

## V8 changes
- Every successful recycler can immediately share a prefilled X post.
- No Employee Record yet? The success screen creates a temporary recycle referral code (`TMP-...`) immediately, so the growth loop does not stop.
- That temporary referral is intended to be claimed/mapped to the real Employee referral when the user creates their Employee Record.
- Existing Employees can also arrive through somebody else's referral link and receive the +20% referred-user Recycling CP bonus.
- Self-referrals are ignored in this prototype.
- Referrer reward remains +40% of the referred swap's base Recycling CP.
- X post bonus remains +25% of base Recycling CP.
- Hold rule remains the final condition for keeping recycle/referral/post bonuses.

## Production backend hooks still required
1. Persist temporary referral codes server-side at successful recycle.
2. Map a temporary referral to the real Employee referral code when that wallet creates/signs into an Employee Record.
3. Persist incoming `?ref=` before login and attach it to the recycle event for both new and existing Employees.
4. Reject self-referrals and define limits for repeated referrer→recycler pairs.
5. Verify completed LI.FI route, X post (for post bonus), and CUCK holding at snapshot/milestones.
6. Pull live Cuckdrop USD-per-CP from the Factory backend.

## Demo
Use `?demo=1` for the simulated $8 BASECAT recycle. Add `&ref=CFR-TEST` to test a referred recycler.
