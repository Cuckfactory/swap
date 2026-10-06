export const PORTFOLIO = {
  // Prototype: Alchemy's public docs-demo key keeps the GitHub test build zero-config.
  // Production: proxy this endpoint through the Cuck Factory Cloudflare Worker and keep the real API key server-side.
  apiKey: import.meta.env.VITE_ALCHEMY_API_KEY || 'docs-demo',
  endpoint: 'https://api.g.alchemy.com/data/v1',
};

export const CUCK = {
  chainId: 4663,
  address: '0x7648f37c2314466726a28f7a5edbdb8dc7b3e23f',
  symbol: 'CUCK',
};

// Prototype only. Production should pull this live from the Factory backend.
export const CUCKDROP_USD_PER_CP = 0.015;

export const BONUS_TIERS = [
  { minUsd: 500, cp: 10000 },
  { minUsd: 250, cp: 7500 },
  { minUsd: 100, cp: 5000 },
  { minUsd: 50, cp: 3500 },
  { minUsd: 25, cp: 2500 },
  { minUsd: 5, cp: 1000 },
  { minUsd: 1, cp: 500 },
];

// Prototype growth mechanic. Kept in config so the team can tune economics
// without redesigning the UX.
export const REFERRAL = {
  // User arriving through somebody else's referral gets +20% Recycling CP.
  referredUserBonusRate: 0.20,
  // Referrer gets +40% of the referred user's base Recycling CP.
  recruiterBonusRate: 0.40,
  // Sharing a real recycle result on X gives +25% more base Recycling CP.
  postBonusRate: 0.25,
};

export function bonusForUsd(usd) {
  const amount = Number(usd || 0);
  const tier = BONUS_TIERS.find((item) => amount >= item.minUsd);
  return tier?.cp ?? 0;
}

export function dropValueForCp(cp) {
  return Number(cp || 0) * CUCKDROP_USD_PER_CP;
}


// V10 smart-routing fallback. LI.FI stays the default cross-chain router.
// If LI.FI cannot see the final CUCK pool, we can bridge into native ETH on
// Robinhood Chain and finish the last leg with KyberSwap, which supports
// Robinhood Chain liquidity directly.
export const ROUTING = {
  robinhoodChainId: 4663,
  robinhoodNativeToken: '0x0000000000000000000000000000000000000000',
  kyberNativeToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  kyberRoutesUrl: 'https://aggregator-api.kyberswap.com/robinhood/api/v1/routes',
  kyberSwapUrl: 'https://kyberswap.com/swap/robinhood',
  kyberClientId: 'cuck-factory-bag-recycler',
  robinhoodRpc: 'https://rpc.mainnet.chain.robinhood.com',
};
