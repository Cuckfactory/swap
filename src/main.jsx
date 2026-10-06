import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChainType,
  LiFiWidget,
  WidgetEvent,
  useWidgetEvents,
} from '@lifi/widget';
import { EthereumProvider } from '@lifi/widget-provider-ethereum';
import { SolanaProvider } from '@lifi/widget-provider-solana';
import {
  bonusForUsd,
  CUCK,
  CUCKDROP_USD_PER_CP,
  dropValueForCp,
  PORTFOLIO,
  REFERRAL,
  ROUTING,
  FACTORY_ROUTE,
} from './config.js';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { createEVMClient } from '@metamask/connect-evm';
import './styles.css';

function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function shortAddress(address) {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test((value || '').trim());
}

function formatUnits(raw, decimals = 18, precision = 4) {
  if (!raw) return '0';
  try {
    const negative = String(raw).startsWith('-');
    const digits = negative ? String(raw).slice(1) : String(raw);
    const padded = digits.padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals) || '0';
    const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, '') : '';
    const clipped = fraction.slice(0, precision);
    return `${negative ? '-' : ''}${whole}${clipped ? `.${clipped}` : ''}`;
  } catch {
    return '0';
  }
}


const ALCHEMY_NETWORKS = {
  'eth-mainnet': { chainId: 1, label: 'Ethereum', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'base-mainnet': { chainId: 8453, label: 'Base', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'arb-mainnet': { chainId: 42161, label: 'Arbitrum', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'opt-mainnet': { chainId: 10, label: 'Optimism', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'bnb-mainnet': { chainId: 56, label: 'BNB Chain', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'polygon-mainnet': { chainId: 137, label: 'Polygon', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'avax-mainnet': { chainId: 43114, label: 'Avalanche', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'linea-mainnet': { chainId: 59144, label: 'Linea', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'scroll-mainnet': { chainId: 534352, label: 'Scroll', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'blast-mainnet': { chainId: 81457, label: 'Blast', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'robinhood-mainnet': { chainId: 4663, label: 'Robinhood Chain', nativeAddress: '0x0000000000000000000000000000000000000000' },
  'sol-mainnet': { chainId: 1151111081099710, label: 'Solana', nativeAddress: '11111111111111111111111111111111' },
};

const EVM_SCAN_BATCHES = [
  ['eth-mainnet', 'base-mainnet', 'arb-mainnet', 'opt-mainnet', 'bnb-mainnet'],
  ['polygon-mainnet', 'avax-mainnet', 'linea-mainnet', 'scroll-mainnet', 'blast-mainnet', 'robinhood-mainnet'],
];

function looksLikeSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((value || '').trim()) && !isEvmAddress(value);
}

function rawToNumber(raw, decimals = 18) {
  try {
    const str = String(raw || '0');
    const integer = str.startsWith('0x') ? BigInt(str) : BigInt(str || '0');
    return Number(formatUnits(integer.toString(), decimals, 12));
  } catch {
    return 0;
  }
}


function decimalToRaw(value, decimals = 18) {
  const text = String(value ?? '').trim();
  if (!/^\d*(?:\.\d*)?$/.test(text) || !text) return '0';
  const [whole = '0', fraction = ''] = text.split('.');
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  try {
    return (BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(padded || '0')).toString();
  } catch {
    return '0';
  }
}

async function rpcCall(method, params = []) {
  // Once an EVM wallet is connected on Robinhood, use its provider for reads too.
  // This avoids browser CORS/RPC issues for balances and Uniswap quotes.
  const injected = window.ethereum;
  if (injected?.request) {
    try {
      const chainHex = await injected.request({ method: 'eth_chainId' });
      if (Number.parseInt(String(chainHex), 16) === FACTORY_ROUTE.bridgeToken.chainId) {
        return await injected.request({ method, params });
      }
    } catch {
      // Fall through to the public read endpoint.
    }
  }

  const endpoint = ROUTING.robinhoodReadRpc || ROUTING.robinhoodRpc;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    throw new Error(`READ_RPC_NETWORK: ${error?.message || 'browser could not reach Robinhood read RPC'}`);
  }
  if (!response.ok) throw new Error(`READ_RPC_HTTP: Robinhood read RPC returned ${response.status}`);
  const json = await response.json();
  if (json?.error) throw new Error(`CHAIN_CALL_REVERT: ${json.error.message || 'Robinhood eth_call failed'}`);
  return json?.result;
}

async function evmTokenDecimals(tokenAddress) {
  if (!tokenAddress || tokenAddress === ROUTING.robinhoodNativeToken || tokenAddress.toLowerCase() === ROUTING.kyberNativeToken.toLowerCase()) return 18;
  try {
    const result = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']);
    return Number.parseInt(result || '0x12', 16) || 18;
  } catch {
    return 18;
  }
}

async function cuckBalance(address) {
  if (!isEvmAddress(address)) return null;
  const selector = '70a08231';
  const arg = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  try {
    const [balanceHex, decimals] = await Promise.all([
      rpcCall('eth_call', [{ to: CUCK.address, data: `0x${selector}${arg}` }, 'latest']),
      evmTokenDecimals(CUCK.address),
    ]);
    return { raw: BigInt(balanceHex || '0x0'), decimals };
  } catch {
    return null;
  }
}


const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
]);

function addressPart(address) {
  return String(address || '').toLowerCase().replace(/^0x/, '').padStart(40, '0');
}

function feePart(fee) {
  return Number(fee || 0).toString(16).padStart(6, '0');
}

function v3Path(tokens, fees) {
  let encoded = addressPart(tokens[0]);
  for (let i = 0; i < fees.length; i += 1) {
    encoded += `${feePart(fees[i])}${addressPart(tokens[i + 1])}`;
  }
  return `0x${encoded}`;
}

function sameAddress(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function normalizeRobinhoodSource(tokenAddress) {
  if (!tokenAddress || sameAddress(tokenAddress, ROUTING.robinhoodNativeToken) || sameAddress(tokenAddress, ROUTING.kyberNativeToken)) {
    return FACTORY_ROUTE.wethToken;
  }
  return tokenAddress;
}

function factoryRouteCandidates(tokenAddress) {
  const token = normalizeRobinhoodSource(tokenAddress);
  const WETH = FACTORY_ROUTE.wethToken;
  const USDG = FACTORY_ROUTE.gatewayToken.address;
  const HOOD = FACTORY_ROUTE.hoodToken;

  if (sameAddress(token, CUCK.address)) return [];
  if (sameAddress(token, HOOD)) {
    return [{ path: v3Path([HOOD, CUCK.address], [FACTORY_ROUTE.hoodToCuckFee]), label: 'HOOD → CUCK' }];
  }
  if (sameAddress(token, USDG)) {
    return [{ path: v3Path([USDG, HOOD, CUCK.address], [FACTORY_ROUTE.usdGToHoodFee, FACTORY_ROUTE.hoodToCuckFee]), label: 'USDG → HOOD → CUCK' }];
  }
  if (sameAddress(token, WETH)) {
    return [{
      path: v3Path(
        [WETH, USDG, HOOD, CUCK.address],
        [FACTORY_ROUTE.wethToUsdGFee, FACTORY_ROUTE.usdGToHoodFee, FACTORY_ROUTE.hoodToCuckFee],
      ),
      label: 'ETH → USDG → HOOD → CUCK',
    }];
  }

  const candidates = [];
  for (const fee of FACTORY_ROUTE.candidateFees) {
    candidates.push({
      path: v3Path(
        [token, WETH, USDG, HOOD, CUCK.address],
        [fee, FACTORY_ROUTE.wethToUsdGFee, FACTORY_ROUTE.usdGToHoodFee, FACTORY_ROUTE.hoodToCuckFee],
      ),
      label: 'TOKEN → ETH → USDG → HOOD → CUCK',
    });
    candidates.push({
      path: v3Path(
        [token, USDG, HOOD, CUCK.address],
        [fee, FACTORY_ROUTE.usdGToHoodFee, FACTORY_ROUTE.hoodToCuckFee],
      ),
      label: 'TOKEN → USDG → HOOD → CUCK',
    });
    candidates.push({
      path: v3Path([token, HOOD, CUCK.address], [fee, FACTORY_ROUTE.hoodToCuckFee]),
      label: 'TOKEN → HOOD → CUCK',
    });
  }
  return candidates;
}

async function waitForReceipt(txHash, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (receipt) {
      if (receipt.status && receipt.status !== '0x1') throw new Error('Transaction reverted');
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error('Transaction confirmation timed out');
}

async function ensureRobinhoodWallet(provider) {
  const chainHex = `0x${FACTORY_ROUTE.gatewayToken.chainId.toString(16)}`;
  const current = await provider.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === chainHex.toLowerCase()) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainHex,
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: [ROUTING.robinhoodWalletRpc || 'https://rpc.mainnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://robinhoodchain.blockscout.com/'],
      }],
    });
  }
}

async function quoteV3Path(path, amountInRaw) {
  const data = encodeFunctionData({
    abi: QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [path, BigInt(amountInRaw)],
  });
  const result = await rpcCall('eth_call', [{ to: FACTORY_ROUTE.quoterV2, data }, 'latest']);
  const decoded = decodeFunctionResult({ abi: QUOTER_ABI, functionName: 'quoteExactInput', data: result });
  const amountOut = Array.isArray(decoded) ? decoded[0] : decoded;
  return BigInt(amountOut || 0);
}

async function findBestFactoryRoute(tokenAddress, amountInRaw) {
  const amount = BigInt(amountInRaw || 0);
  if (amount <= 0n) return null;
  let best = null;
  let infrastructureError = null;

  for (const candidate of factoryRouteCandidates(tokenAddress)) {
    try {
      const amountOut = await quoteV3Path(candidate.path, amount);
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) best = { ...candidate, amountOut };
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('READ_RPC_NETWORK') || message.includes('READ_RPC_HTTP')) {
        infrastructureError = error;
        break;
      }
      // A reverted quote normally just means this candidate pool/path is not usable.
    }
  }

  if (!best && infrastructureError) throw infrastructureError;
  return best;
}

async function quoteRobinhoodUsd(tokenAddress, amountInRaw) {
  const amount = BigInt(amountInRaw || 0);
  if (amount <= 0n) return 0;
  const token = normalizeRobinhoodSource(tokenAddress);
  const WETH = FACTORY_ROUTE.wethToken;
  const USDG = FACTORY_ROUTE.gatewayToken.address;
  const HOOD = FACTORY_ROUTE.hoodToken;
  try {
    if (sameAddress(token, USDG)) return Number(formatUnits(amount.toString(), FACTORY_ROUTE.gatewayToken.decimals, 6));
    let path = null;
    if (sameAddress(token, WETH)) path = v3Path([WETH, USDG], [FACTORY_ROUTE.wethToUsdGFee]);
    else if (sameAddress(token, HOOD)) path = v3Path([HOOD, USDG], [FACTORY_ROUTE.usdGToHoodFee]);
    if (path) {
      const out = await quoteV3Path(path, amount);
      return Number(formatUnits(out.toString(), FACTORY_ROUTE.gatewayToken.decimals, 6));
    }
  } catch {}
  return 0;
}

async function robinhoodTokenBalance(address, tokenAddress) {
  if (!isEvmAddress(address)) return null;
  try {
    if (!tokenAddress || sameAddress(tokenAddress, ROUTING.robinhoodNativeToken)) {
      const balanceHex = await rpcCall('eth_getBalance', [address, 'latest']);
      return { raw: BigInt(balanceHex || '0x0'), decimals: 18 };
    }
    const selector = '70a08231';
    const arg = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const [balanceHex, decimals] = await Promise.all([
      rpcCall('eth_call', [{ to: tokenAddress, data: `0x${selector}${arg}` }, 'latest']),
      evmTokenDecimals(tokenAddress),
    ]);
    return { raw: BigInt(balanceHex || '0x0'), decimals };
  } catch {
    return null;
  }
}

async function erc20Allowance(token, owner, spender) {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, spender] });
  const result = await rpcCall('eth_call', [{ to: token, data }, 'latest']);
  return BigInt(decodeFunctionResult({ abi: ERC20_ABI, functionName: 'allowance', data: result }) || 0);
}

async function approveErc20(provider, from, token, spender, amount) {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] });
  const txHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from, to: token, data }] });
  await waitForReceipt(txHash);
  return txHash;
}

async function executeFactoryDirect({ tokenAddress, amountInRaw, recipient, expectedSourceAccount = '' }) {
  const provider = window.ethereum;
  if (!provider?.request) throw new Error('Open this page in an EVM wallet browser or enable MetaMask.');
  await ensureRobinhoodWallet(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const account = accounts?.[0];
  if (!isEvmAddress(account)) throw new Error('No EVM wallet connected.');
  if (expectedSourceAccount && account.toLowerCase() !== expectedSourceAccount.toLowerCase()) {
    throw new Error(`Connect ${shortAddress(expectedSourceAccount)} — that wallet holds this bag.`);
  }

  const finalRecipient = isEvmAddress(recipient) ? recipient : account;
  const amount = BigInt(amountInRaw || 0);
  if (amount <= 0n) throw new Error('Choose an amount first.');
  const route = await findBestFactoryRoute(tokenAddress, amount);
  if (!route) throw new Error('No working Robinhood liquidity path to $CUCK for this token/amount.');

  const isNative = !tokenAddress || sameAddress(tokenAddress, ROUTING.robinhoodNativeToken);
  if (!isNative) {
    const allowance = await erc20Allowance(tokenAddress, account, FACTORY_ROUTE.swapRouter02);
    if (allowance < amount) await approveErc20(provider, account, tokenAddress, FACTORY_ROUTE.swapRouter02, amount);
  }

  const minOut = route.amountOut * BigInt(10000 - FACTORY_ROUTE.finalSlippageBps) / 10000n;
  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInput',
    args: [{ path: route.path, recipient: finalRecipient, amountIn: amount, amountOutMinimum: minOut }],
  });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: account,
      to: FACTORY_ROUTE.swapRouter02,
      data,
      value: isNative ? `0x${amount.toString(16)}` : '0x0',
    }],
  });
  await waitForReceipt(txHash);
  return { txHash, quotedOut: route.amountOut, route, recipient: finalRecipient };
}

function tokenUsdPrice(token) {
  const price = token?.tokenPrices?.find?.((item) => item?.currency === 'usd')?.value
    ?? token?.tokenPrices?.[0]?.value;
  const parsed = Number(price);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function fetchAlchemyTokenBatch(address, networks) {
  if (!address || !networks?.length) return [];
  const response = await fetch(`${PORTFOLIO.endpoint}/${PORTFOLIO.apiKey}/assets/tokens/by-address`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      addresses: [{ address, networks }],
      withMetadata: true,
      withPrices: true,
      includeNativeTokens: true,
      includeErc20Tokens: true,
    }),
  });
  if (!response.ok) throw new Error(`Portfolio scan failed (${response.status})`);
  const json = await response.json();
  return Array.isArray(json?.data?.tokens) ? json.data.tokens : [];
}

function normalizeHolding(token) {
  const network = ALCHEMY_NETWORKS[token?.network];
  if (!network) return null;
  const meta = token?.tokenMetadata || {};
  const decimals = Number.isFinite(Number(meta.decimals)) ? Number(meta.decimals) : 18;
  const balance = rawToNumber(token?.tokenBalance, decimals);
  if (!Number.isFinite(balance) || balance <= 0) return null;
  const price = tokenUsdPrice(token);
  const usd = price > 0 ? balance * price : 0;
  const address = token?.tokenAddress || network.nativeAddress;
  const symbol = meta.symbol || token?.symbol || 'TOKEN';
  if (String(address).toLowerCase() === CUCK.address.toLowerCase()) return null;
  return {
    id: `${network.chainId}:${address}`,
    chainId: network.chainId,
    chainLabel: network.label,
    tokenAddress: address,
    symbol,
    name: meta.name || symbol,
    logo: meta.logo || meta.logoUrl || '',
    balance,
    rawBalance: String(token?.tokenBalance || '0'),
    decimals,
    usd,
  };
}

function leftoverRank(usd) {
  if (usd >= 1 && usd <= 50) return 0;
  if (usd >= 0.25 && usd < 1) return 1;
  if (usd > 50 && usd <= 250) return 2;
  if (usd > 250) return 3;
  return 4;
}

function defaultRecycleAmount(holding) {
  const balance = Number(holding?.balance || 0);
  if (!Number.isFinite(balance) || balance <= 0) return '';

  const address = String(holding?.tokenAddress || '').toLowerCase();
  const isEvmNative = address === ROUTING.robinhoodNativeToken.toLowerCase();
  const isSolNative = address === '11111111111111111111111111111111';

  // Leave a little native gas behind. ERC-20/SPL leftovers can use the full balance.
  const multiplier = (isEvmNative || isSolNative) ? 0.95 : 1;
  return String(Number((balance * multiplier).toPrecision(10)));
}

async function rpcCallUrl(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const json = await response.json();
  if (json?.error) throw new Error(json.error.message || 'RPC error');
  return json?.result;
}

async function scanNativeEvmBalances(address) {
  if (!isEvmAddress(address)) return [];

  const entries = Object.entries(EVM_CHAIN_META);
  const settled = await Promise.allSettled(entries.map(async ([chainIdText, meta]) => {
    const chainId = Number(chainIdText);
    const rpcUrl = meta?.rpcUrls?.[0];
    if (!rpcUrl) return null;

    const rawHex = await rpcCallUrl(rpcUrl, 'eth_getBalance', [address, 'latest']);
    const raw = BigInt(rawHex || '0x0');
    if (raw <= 0n) return null;

    const decimals = Number(meta?.nativeCurrency?.decimals || 18);
    const balance = Number(formatUnits(raw.toString(), decimals, 10));
    if (!Number.isFinite(balance) || balance <= 0) return null;

    return {
      id: `${chainId}:0x0000000000000000000000000000000000000000`,
      chainId,
      chainLabel: meta.chainName || `Chain ${chainId}`,
      tokenAddress: '0x0000000000000000000000000000000000000000',
      symbol: meta?.nativeCurrency?.symbol || 'ETH',
      name: meta?.nativeCurrency?.name || meta?.nativeCurrency?.symbol || 'Native token',
      logo: '',
      balance,
      rawBalance: raw.toString(),
      decimals,
      usd: 0,
    };
  }));

  return settled
    .filter((item) => item.status === 'fulfilled' && item.value)
    .map((item) => item.value);
}

async function scanConnectedWallet({ evmAddress, solanaAddress }) {
  const portfolioJobs = [];
  if (isEvmAddress(evmAddress)) {
    EVM_SCAN_BATCHES.forEach((networks) => portfolioJobs.push(fetchAlchemyTokenBatch(evmAddress, networks)));
  }
  if (looksLikeSolanaAddress(solanaAddress)) {
    portfolioJobs.push(fetchAlchemyTokenBatch(solanaAddress, ['sol-mainnet']));
  }

  const [portfolioSettled, nativeHoldings] = await Promise.all([
    Promise.allSettled(portfolioJobs),
    isEvmAddress(evmAddress) ? scanNativeEvmBalances(evmAddress) : Promise.resolve([]),
  ]);

  const portfolioHoldings = portfolioSettled
    .flatMap((item) => item.status === 'fulfilled' ? item.value : [])
    .map(normalizeHolding)
    .filter(Boolean);

  let holdings = [...nativeHoldings, ...portfolioHoldings];

  const seen = new Set();
  holdings = holdings.filter((item) => {
    if (!item || item.balance <= 0) return false;
    if (String(item.tokenAddress).toLowerCase() === CUCK.address.toLowerCase()) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Native balances are useful even when a price indexer is unavailable.
  holdings.sort((a, b) => {
    const aPriced = a.usd > 0 ? 1 : 0;
    const bPriced = b.usd > 0 ? 1 : 0;
    if (aPriced !== bPriced) return bPriced - aPriced;
    if (a.usd !== b.usd) return b.usd - a.usd;
    return b.balance - a.balance;
  });

  const allPortfolioFailed = portfolioJobs.length > 0
    && portfolioSettled.length > 0
    && portfolioSettled.every((item) => item.status === 'rejected');

  if (!holdings.length && allPortfolioFailed) {
    const firstFailure = portfolioSettled.find((item) => item.status === 'rejected');
    throw new Error(firstFailure?.reason?.message || 'Token scan unavailable');
  }

  return holdings;
}

function getRouteUsd(route, side) {
  if (!route) return 0;
  const direct = Number(route[`${side}AmountUSD`]);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const amount = route[`${side}Amount`];
  const token = route[`${side}Token`];
  const price = Number(token?.priceUSD);
  if (!amount || !token || !Number.isFinite(price) || price <= 0) return 0;
  const human = Number(formatUnits(amount, token.decimals ?? 18, 12));
  return Number.isFinite(human) ? human * price : 0;
}

function EventBridge({ onQuote, onCompleted, onStarted, onWalletConnected, onRoutes, onFormChanged, onSourceSelected }) {
  const widgetEvents = useWidgetEvents();

  useEffect(() => {
    const available = (routes) => {
      const list = Array.isArray(routes) ? routes : [];
      onRoutes?.(list);
      const route = list[0] || null;
      if (route) onQuote(route);
    };
    const selected = (payload) => {
      if (payload?.route) onQuote(payload.route);
    };
    const started = (route) => onStarted(route);
    const completed = (route) => onCompleted(route);
    const walletConnected = (payload) => onWalletConnected?.(payload);
    const formChanged = (payload) => onFormChanged?.(payload);
    const sourceSelected = (payload) => onSourceSelected?.(payload);

    widgetEvents.on(WidgetEvent.AvailableRoutes, available);
    widgetEvents.on(WidgetEvent.RouteSelected, selected);
    widgetEvents.on(WidgetEvent.RouteExecutionStarted, started);
    widgetEvents.on(WidgetEvent.RouteExecutionCompleted, completed);
    widgetEvents.on(WidgetEvent.WalletConnected, walletConnected);
    if (WidgetEvent.FormFieldChanged) widgetEvents.on(WidgetEvent.FormFieldChanged, formChanged);
    if (WidgetEvent.SourceChainTokenSelected) widgetEvents.on(WidgetEvent.SourceChainTokenSelected, sourceSelected);

    return () => widgetEvents.removeAllListeners();
  }, [widgetEvents, onQuote, onCompleted, onStarted, onWalletConnected, onRoutes, onFormChanged, onSourceSelected]);

  return null;
}

function DealCard({ quote, referredBy }) {
  const exampleUsd = 5;
  const sourceUsd = quote?.fromUsd > 0 ? quote.fromUsd : exampleUsd;
  const receivedUsd = quote?.toUsd > 0 ? quote.toUsd : sourceUsd;
  const baseCp = bonusForUsd(sourceUsd);
  const referralExtraCp = referredBy ? Math.round(baseCp * REFERRAL.referredUserBonusRate) : 0;
  const recycleCp = baseCp + referralExtraCp;
  const dropUsd = dropValueForCp(recycleCp);
  const totalValue = receivedUsd + dropUsd;
  const live = quote?.fromUsd > 0;

  return (
    <section className={`deal-card ${live ? 'is-live' : ''}`} aria-live="polite">
      <span className="deal-kicker">{live ? 'YOUR DEAL' : 'SIMPLE EXAMPLE'}</span>
      <h2>{money(sourceUsd)} LEFTOVER → ≈ {money(totalValue)} TOTAL VALUE</h2>
      <div className="deal-split">
        <div>
          <span>YOU KEEP</span>
          <strong>≈ {money(receivedUsd)}</strong>
          <small>IN $CUCK</small>
        </div>
        <div className="plus">+</div>
        <div className="bonus">
          <span>EST. CUCKDROP VALUE</span>
          <strong>≈ {money(dropUsd)}</strong>
          <small>+{recycleCp.toLocaleString('en-US')} Cuck Power</small>
        </div>
      </div>
      <div className="deal-foot">
        <span>Estimated at the current Cuckdrop value.</span>
        {referredBy ? <b>Referral active · +20% Recycling Cuck Power included</b> : null}
      </div>
    </section>
  );
}


function WalletHoldings({ holdings, loading, error, connected, onRecycle, selected }) {
  const [showAll, setShowAll] = useState(false);

  // The swap itself is always visible. This block only accelerates bag selection.
  if (!connected && !loading) return null;

  if (loading) {
    return (
      <div className="wallet-finder scanning compact-scan">
        <span className="pulse" /> FINDING YOUR LEFTOVERS…
      </div>
    );
  }

  if (error || !holdings.length) return null;

  const visible = showAll ? holdings : holdings.slice(0, 5);

  return (
    <section className="wallet-finder found embedded-holdings">
      <div className="wallet-finder-head">
        <div>
          <span className="wallet-finder-kicker">FOUND IN YOUR WALLET</span>
          <strong>PICK ONE.</strong>
        </div>
        <small>Amount is prefilled</small>
      </div>

      <div className="holding-list">
        {visible.map((item) => {
          const active = selected?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`holding-row ${active ? 'active' : ''}`}
              onClick={() => onRecycle(item)}
            >
              <span className="holding-logo">
                {item.logo ? <img src={item.logo} alt="" /> : <b>{item.symbol.slice(0, 1)}</b>}
              </span>
              <span className="holding-main">
                <b>${item.symbol}</b>
                <small>{item.chainLabel}</small>
              </span>
              <span className="holding-value">
                <b>{item.usd > 0 ? money(item.usd) : `${item.balance.toLocaleString('en-US', { maximumFractionDigits: 5 })} ${item.symbol}`}</b>
                <small>{item.usd > 0 ? `${item.balance.toLocaleString('en-US', { maximumFractionDigits: 5 })} ${item.symbol}` : 'wallet balance'}</small>
              </span>
              <span className="holding-action">{active ? 'SELECTED ✓' : 'USE →'}</span>
            </button>
          );
        })}
      </div>

      {holdings.length > 5 ? (
        <button className="show-holdings" type="button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'SHOW FEWER' : `SHOW ${holdings.length - 5} MORE`}
        </button>
      ) : null}
    </section>
  );
}
function EmployeeLine({ destination, employeeId }) {
  if (!isEvmAddress(destination)) return null;
  return (
    <div className="employee-line">
      <span>✓ {employeeId || 'EMPLOYEE'} RECOGNISED</span>
      <b>$CUCK destination {shortAddress(destination)}</b>
    </div>
  );
}

function RobinhoodDirectSwap({ destination, sourceToken, onQuote, onFinished, onWalletConnected, onUseCrossChain }) {
  const token = sourceToken;
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [balanceRaw, setBalanceRaw] = useState(0n);
  const [route, setRoute] = useState(null);
  const [cuckDecimals, setCuckDecimals] = useState(18);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  const tokenAddress = token?.tokenAddress || ROUTING.robinhoodNativeToken;
  const tokenDecimals = token?.decimals ?? 18;
  const humanBalance = Number(formatUnits(balanceRaw.toString(), tokenDecimals, 10));

  const connect = async () => {
    try {
      const provider = window.ethereum;
      if (!provider?.request) throw new Error('No EVM wallet detected.');
      await ensureRobinhoodWallet(provider);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0] || '';
      if (!isEvmAddress(address)) throw new Error('No EVM wallet connected.');
      setAccount(address);
      onWalletConnected?.({ address });
      const bal = await robinhoodTokenBalance(address, tokenAddress);
      if (bal) setBalanceRaw(bal.raw);
      setError('');
      return address;
    } catch (err) {
      setError(err?.message || 'Wallet connection failed.');
      return '';
    }
  };

  useEffect(() => {
    setAmount('');
    setRoute(null);
    setState('idle');
    setError('');
    if (token?.rawBalance) {
      try { setBalanceRaw(BigInt(token.rawBalance)); } catch { setBalanceRaw(0n); }
    } else setBalanceRaw(0n);
  }, [token?.id]);

  useEffect(() => {
    const numeric = Number(amount || 0);
    if (!token || !numeric || numeric <= 0) {
      setRoute(null);
      setState('idle');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState('quoting');
      setError('');
      try {
        const raw = decimalToRaw(amount, tokenDecimals);
        const [found, cDec, directUsd] = await Promise.all([
          findBestFactoryRoute(tokenAddress, raw),
          evmTokenDecimals(CUCK.address),
          quoteRobinhoodUsd(tokenAddress, raw),
        ]);
        if (cancelled) return;
        setCuckDecimals(cDec);
        if (!found) {
          setRoute(null);
          setState('no-route');
          setError('No Robinhood liquidity path to $CUCK for this amount yet.');
          return;
        }
        setRoute(found);
        setState('ready');
        const proportionalUsd = token.usd > 0 && token.balance > 0 ? token.usd * (numeric / token.balance) : 0;
        const fromUsd = directUsd || proportionalUsd;
        onQuote?.({ fromUsd, toUsd: fromUsd });
      } catch (err) {
        if (cancelled) return;
        setRoute(null);
        setState('error');
        const message = err?.message || 'Route check failed.';
        setError(message.includes('READ_RPC_')
          ? 'Could not read Robinhood right now. Reconnect the wallet and try again.'
          : message);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [amount, token?.id, tokenAddress, tokenDecimals]);

  const execute = async () => {
    if (!token || !route) return;
    const wallet = account || await connect();
    if (!wallet) return;
    setState('executing');
    setError('');
    try {
      const recipient = isEvmAddress(destination) ? destination : wallet;
      const before = await cuckBalance(recipient);
      const raw = decimalToRaw(amount, tokenDecimals);
      const execution = await executeFactoryDirect({
        tokenAddress,
        amountInRaw: raw,
        recipient,
        expectedSourceAccount: wallet,
      });
      const after = await cuckBalance(recipient);
      const beforeRaw = before?.raw ?? 0n;
      const afterRaw = after?.raw ?? 0n;
      const diff = afterRaw > beforeRaw ? afterRaw - beforeRaw : execution.quotedOut;
      const decimals = after?.decimals ?? before?.decimals ?? cuckDecimals;
      const directUsd = await quoteRobinhoodUsd(tokenAddress, raw);
      const proportionalUsd = token.usd > 0 && token.balance > 0 ? token.usd * (Number(amount) / token.balance) : 0;
      const fromUsd = directUsd || proportionalUsd;
      onFinished?.({
        fromUsd,
        toUsd: fromUsd,
        cuckAmount: formatUnits(diff.toString(), decimals, 4),
        fromSymbol: token.symbol || 'TOKEN',
        fromAmount: amount,
        destination: recipient,
        finishTxHash: execution.txHash,
      });
      setState('done');
    } catch (err) {
      setState('error');
      setError(err?.message || 'Recycle failed.');
    }
  };

  const maxAmount = humanBalance || Number(token?.balance || 0);
  const setPct = (pct) => {
    if (!maxAmount) return;
    let value = maxAmount * pct;
    // Native ETH needs a little left behind for gas.
    if (sameAddress(tokenAddress, ROUTING.robinhoodNativeToken) && pct >= 1) value = maxAmount * 0.97;
    setAmount(String(Number(value.toPrecision(8))));
  };

  if (!token) return null;
  const quotedCuck = route ? formatUnits(route.amountOut.toString(), cuckDecimals, 4) : '—';

  return (
    <section className="direct-swap">
      <div className="swap-heading">
        <strong>RECYCLE ${token.symbol}</strong>
        <span>The Factory routes it on Robinhood and your wallet receives $CUCK.</span>
      </div>
      <div className="direct-route-badge">ROBINHOOD DIRECT · FINAL OUTPUT $CUCK</div>
      <div className="direct-grid">
        <div className="direct-token-card"><span>FROM</span><strong>{token.symbol}</strong><small>Robinhood Chain</small></div>
        <div className="direct-token-card output"><span>TO</span><strong>$CUCK</strong><small>Robinhood Chain</small></div>
      </div>
      <label className="direct-amount"><span>AMOUNT</span><div><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><b>{token.symbol}</b></div></label>
      {maxAmount > 0 ? <div className="direct-percent-row"><button type="button" onClick={() => setPct(.25)}>25%</button><button type="button" onClick={() => setPct(.5)}>50%</button><button type="button" onClick={() => setPct(.75)}>75%</button><button type="button" onClick={() => setPct(1)}>MAX</button></div> : null}
      <div className="direct-quote"><span>YOU RECEIVE</span><strong>{state === 'quoting' ? 'CHECKING…' : route ? `≈ ${quotedCuck} $CUCK` : '— $CUCK'}</strong>{route ? <small>Factory route found ✓</small> : null}</div>
      {error ? <div className="factory-finish-error">{error}</div> : null}
      <button type="button" className="direct-recycle" onClick={execute} disabled={!route || state === 'quoting' || state === 'executing' || state === 'done'}>{state === 'executing' ? 'RECYCLING…' : state === 'done' ? 'BAG RECYCLED ✓' : 'RECYCLE → $CUCK'}</button>
      <button type="button" className="direct-other" onClick={onUseCrossChain}>TOKEN ON ANOTHER CHAIN? →</button>
      <small className="direct-note">USDG / HOOD may be used under the hood, but they are never your final asset.</small>
    </section>
  );
}




let metamaskConnectClientPromise = null;

function metamaskSupportedNetworks() {
  return {
    '0x1': 'https://ethereum-rpc.publicnode.com',
    '0xa': 'https://mainnet.optimism.io',
    '0x38': 'https://bsc-dataseed.binance.org',
    '0x89': 'https://polygon-rpc.com',
    '0x2105': 'https://mainnet.base.org',
    '0xa4b1': 'https://arb1.arbitrum.io/rpc',
    '0xa86a': 'https://api.avax.network/ext/bc/C/rpc',
    '0xe708': 'https://rpc.linea.build',
    '0x13e31': 'https://rpc.blast.io',
    '0x82750': 'https://rpc.scroll.io',
    '0x1237': ROUTING.robinhoodWalletRpc || 'https://rpc.mainnet.chain.robinhood.com',
  };
}

async function getMetaMaskConnectClient() {
  if (!metamaskConnectClientPromise) {
    metamaskConnectClientPromise = createEVMClient({
      dapp: {
        name: 'The Cuck Factory',
        url: window.location.origin + window.location.pathname,
      },
      api: {
        supportedNetworks: metamaskSupportedNetworks(),
      },
    });
  }
  return metamaskConnectClientPromise;
}

async function connectMetaMaskUniversal() {
  const client = await getMetaMaskConnectClient();
  const result = await client.connect({ chainIds: ['0x1'], forceRequest: true });
  const provider = client.getProvider();
  const address = result?.accounts?.[0] || '';
  if (!provider?.request || !isEvmAddress(address)) {
    throw new Error('MetaMask connection did not return an EVM account.');
  }
  return { provider, address, label: 'MetaMask' };
}

function openCurrentDappInPhantom() {
  const url = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);
  window.location.href = `https://phantom.app/ul/browse/${url}?ref=${ref}`;
}

function discoverEvmWallets() {
  return new Promise((resolve) => {
    const found = new Map();
    const add = (provider, label) => {
      if (!provider?.request) return;
      const key = label + (provider.isMetaMask ? ':mm' : provider.isPhantom ? ':ph' : '');
      if ([...found.values()].some((item) => item.provider === provider)) return;
      found.set(key, { provider, label });
    };
    const onAnnounce = (event) => {
      const info = event?.detail?.info;
      const provider = event?.detail?.provider;
      if (provider) add(provider, info?.name || 'Wallet');
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const injected = window.ethereum;
      const list = Array.isArray(injected?.providers) ? injected.providers : (injected ? [injected] : []);
      list.forEach((provider) => {
        if (provider?.isMetaMask && !provider?.isPhantom) add(provider, 'MetaMask');
        else if (provider?.isPhantom) add(provider, 'Phantom');
        else add(provider, 'Browser wallet');
      });
      if (window.phantom?.ethereum) add(window.phantom.ethereum, 'Phantom');
      resolve([...found.values()]);
    }, 250);
  });
}

const EVM_CHAIN_META = {
  1: { chainName: 'Ethereum', rpcUrls: ['https://ethereum-rpc.publicnode.com'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  10: { chainName: 'Optimism', rpcUrls: ['https://mainnet.optimism.io'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  56: { chainName: 'BNB Smart Chain', rpcUrls: ['https://bsc-dataseed.binance.org'], nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 } },
  137: { chainName: 'Polygon', rpcUrls: ['https://polygon-rpc.com'], nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 } },
  8453: { chainName: 'Base', rpcUrls: ['https://mainnet.base.org'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  42161: { chainName: 'Arbitrum One', rpcUrls: ['https://arb1.arbitrum.io/rpc'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  43114: { chainName: 'Avalanche C-Chain', rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'], nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 } },
  59144: { chainName: 'Linea', rpcUrls: ['https://rpc.linea.build'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  81457: { chainName: 'Blast', rpcUrls: ['https://rpc.blast.io'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  534352: { chainName: 'Scroll', rpcUrls: ['https://rpc.scroll.io'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  4663: { chainName: 'Robinhood Chain', rpcUrls: [ROUTING.robinhoodWalletRpc || 'https://rpc.mainnet.chain.robinhood.com'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
};

async function ensureEvmChain(provider, chainId) {
  if (!provider?.request) throw new Error('No EVM wallet detected.');
  const target = `0x${Number(chainId).toString(16)}`;
  const current = await provider.request({ method: 'eth_chainId' }).catch(() => '');
  if (String(current).toLowerCase() === target.toLowerCase()) return;

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    const meta = EVM_CHAIN_META[Number(chainId)];
    if (!meta) throw new Error(`Add chain ${chainId} to your wallet and try again.`);
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: target, ...meta }],
    });
  }
}

async function waitForProviderReceipt(provider, txHash, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
    if (receipt) {
      if (receipt.status && receipt.status !== '0x1') throw new Error('Transaction reverted.');
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error('Transaction confirmation timed out.');
}

async function providerAllowance(provider, token, owner, spender) {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, spender] });
  const result = await provider.request({
    method: 'eth_call',
    params: [{ to: token, data }, 'latest'],
  });
  return BigInt(decodeFunctionResult({ abi: ERC20_ABI, functionName: 'allowance', data: result }) || 0);
}

async function providerApprove(provider, from, token, spender, amount) {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: token, data }],
  });
  await waitForProviderReceipt(provider, txHash);
  return txHash;
}


function DirectEvmCuckSwap({ destination, wallet, sourceToken, holdings = [], holdingsLoading = false, holdingsError = '', onSelectHolding, onWalletConnected, onWalletDisconnected, onQuote, onFinished }) {
  const walletProviderRef = React.useRef(null);
  const [walletChoices, setWalletChoices] = useState([]);
  const [walletLabel, setWalletLabel] = useState('');
  const [account, setAccount] = useState(isEvmAddress(wallet) ? wallet : '');
  const [fallbackBalance, setFallbackBalance] = useState(0);
  const [amount, setAmount] = useState(sourceToken ? defaultRecycleAmount(sourceToken) : '');
  const [quoteBody, setQuoteBody] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    discoverEvmWallets().then((items) => { if (live) setWalletChoices(items); });
    return () => { live = false; };
  }, []);

  const fallbackToken = {
    id: '4663:0x0000000000000000000000000000000000000000',
    chainId: CUCK.chainId,
    chainLabel: 'Robinhood Chain',
    tokenAddress: ROUTING.robinhoodNativeToken,
    symbol: 'ETH',
    name: 'Ethereum',
    balance: fallbackBalance,
    rawBalance: '',
    decimals: 18,
    usd: 0,
  };
  const token = sourceToken || (fallbackBalance > 0 ? fallbackToken : null);
  const chainId = Number(token?.chainId || 0);
  const tokenAddress = token?.tokenAddress || '';
  const tokenDecimals = token?.decimals ?? 18;
  const isNative = sameAddress(tokenAddress, '0x0000000000000000000000000000000000000000');

  useEffect(() => {
    if (isEvmAddress(wallet)) setAccount(wallet);
  }, [wallet]);

  useEffect(() => {
    if (sourceToken) setAmount(defaultRecycleAmount(sourceToken));
    setQuoteBody(null);
    setState('idle');
    setError('');
  }, [sourceToken?.id]);

  const connectChoice = async (choice) => {
    setError('');
    try {
      const provider = choice?.provider;
      if (!provider?.request) throw new Error('That wallet is not available.');
      walletProviderRef.current = provider;
      setWalletLabel(choice.label);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0] || '';
      if (!isEvmAddress(address)) throw new Error('No account returned.');
      setAccount(address);
      onWalletConnected?.({ address });

      if (!sourceToken) {
        try {
          const balanceHex = await rpcCall('eth_getBalance', [address, 'latest']);
          const balance = Number(formatUnits(BigInt(balanceHex || '0x0').toString(), 18, 10));
          setFallbackBalance(balance);
          if (balance > 0) setAmount(String(Number((balance * 0.95).toPrecision(10))));
        } catch {
          // The user can still type an amount manually.
        }
      }

      return address;
    } catch (err) {
      setError(err?.message || 'Wallet connection failed.');
      return '';
    }
  };

  const connectMetaMask = async () => {
    setError('');
    setState('connecting');

    try {
      const discovered = walletChoices.length ? walletChoices : await discoverEvmWallets();
      const injectedMetaMask = discovered.find((choice) => choice.label === 'MetaMask');

      if (injectedMetaMask?.provider?.request) {
        const address = await connectChoice(injectedMetaMask);
        if (address) setState('idle');
        return address;
      }

      const connected = await connectMetaMaskUniversal();
      walletProviderRef.current = connected.provider;
      setWalletLabel(connected.label);
      setAccount(connected.address);
      onWalletConnected?.({ address: connected.address });

      try {
        const balanceHex = await rpcCall('eth_getBalance', [connected.address, 'latest']);
        const balance = Number(formatUnits(BigInt(balanceHex || '0x0').toString(), 18, 10));
        setFallbackBalance(balance);
        if (!sourceToken && balance > 0) {
          setAmount(String(Number((balance * 0.95).toPrecision(10))));
        }
      } catch {}

      setState('idle');
      return connected.address;
    } catch (err) {
      setState('error');
      setError(err?.message || 'Wallet connection failed.');
      return '';
    }
  };


  const disconnectCurrent = async () => {
    try {
      if (/metamask/i.test(walletLabel || '')) {
        const client = await getMetaMaskConnectClient();
        await client.disconnect().catch(() => {});
      }
    } catch {}

    walletProviderRef.current = null;
    setWalletLabel('');
    setAccount('');
    setFallbackBalance(0);
    setAmount('');
    setQuoteBody(null);
    setState('idle');
    setError('');
    onWalletDisconnected?.();
  };


  useEffect(() => {
    const numeric = Number(amount || 0);

    if (!token || !chainId || !tokenAddress || !numeric || numeric <= 0 || !isEvmAddress(account)) {
      setQuoteBody(null);
      if (!token || !numeric) setState('idle');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState('quoting');
      setError('');
      setQuoteBody(null);

      try {
        const recipient = isEvmAddress(destination) ? destination : account;
        const rawAmount = decimalToRaw(amount, tokenDecimals);
        const params = new URLSearchParams({
          fromChain: String(chainId),
          toChain: String(CUCK.chainId),
          fromToken: tokenAddress,
          toToken: CUCK.address,
          fromAmount: rawAmount,
          fromAddress: account,
          toAddress: recipient,
          slippage: '0.03',
          integrator: 'cuckfactory',
        });

        const response = await fetch(`https://li.quest/v1/quote?${params.toString()}`);
        const body = await response.json().catch(() => null);
        if (cancelled) return;

        if (!response.ok || !body?.transactionRequest) {
          throw new Error(body?.message || body?.error?.message || 'No executable LI.FI route for this bag.');
        }

        setQuoteBody(body);
        setState('ready');

        const fromPrice = Number(body?.action?.fromToken?.priceUSD || 0);
        const fromUsd = fromPrice > 0
          ? fromPrice * numeric
          : (token.usd > 0 && token.balance > 0 ? token.usd * (numeric / token.balance) : 0);

        const toDecimals = body?.action?.toToken?.decimals ?? 18;
        const toHuman = Number(formatUnits(body?.estimate?.toAmount || '0', toDecimals, 10));
        const toPrice = Number(body?.action?.toToken?.priceUSD || 0);
        const toUsd = toPrice > 0 ? toPrice * toHuman : fromUsd;

        onQuote?.({ fromUsd, toUsd: toUsd || fromUsd });
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setError(err?.message || 'Quote failed.');
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, account, destination, token?.id, chainId, tokenAddress, tokenDecimals]);

  const execute = async () => {
    if (!quoteBody?.transactionRequest || !token) return;

    let signer = account;
    if (!isEvmAddress(signer)) signer = await connectMetaMask();
    if (!isEvmAddress(signer)) return;

    setState('executing');
    setError('');

    try {
      const provider = walletProviderRef.current;
      if (!provider?.request) throw new Error('No EVM wallet detected.');

      await ensureEvmChain(provider, chainId);

      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const active = accounts?.[0] || '';
      if (!isEvmAddress(active)) throw new Error('No EVM wallet connected.');
      if (active.toLowerCase() !== signer.toLowerCase()) {
        throw new Error(`Connect ${shortAddress(signer)} to recycle this bag.`);
      }

      const approvalAddress = quoteBody?.estimate?.approvalAddress;
      if (!isNative && isEvmAddress(approvalAddress)) {
        const rawAmount = BigInt(decimalToRaw(amount, tokenDecimals));
        const allowance = await providerAllowance(provider, tokenAddress, active, approvalAddress);
        if (allowance < rawAmount) {
          await providerApprove(provider, active, tokenAddress, approvalAddress, rawAmount);
        }
      }

      const req = quoteBody.transactionRequest;
      const tx = {
        from: active,
        to: req.to,
        data: req.data || '0x',
        value: req.value || '0x0',
      };
      if (req.gasLimit) tx.gas = req.gasLimit;
      else if (req.gas) tx.gas = req.gas;
      if (req.gasPrice) tx.gasPrice = req.gasPrice;
      if (req.maxFeePerGas) tx.maxFeePerGas = req.maxFeePerGas;
      if (req.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = req.maxPriorityFeePerGas;

      const txHash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
      await waitForProviderReceipt(provider, txHash);

      const toDecimals = quoteBody?.action?.toToken?.decimals ?? 18;
      const toAmount = quoteBody?.estimate?.toAmount || '0';
      const numeric = Number(amount || 0);

      const fromPrice = Number(quoteBody?.action?.fromToken?.priceUSD || 0);
      const fromUsd = fromPrice > 0
        ? fromPrice * numeric
        : (token.usd > 0 && token.balance > 0 ? token.usd * (numeric / token.balance) : 0);

      const toHuman = Number(formatUnits(toAmount, toDecimals, 10));
      const toPrice = Number(quoteBody?.action?.toToken?.priceUSD || 0);
      const toUsd = toPrice > 0 ? toPrice * toHuman : fromUsd;

      onFinished?.({
        fromUsd,
        toUsd: toUsd || fromUsd,
        cuckAmount: formatUnits(toAmount, toDecimals, 4),
        fromSymbol: token.symbol || 'TOKEN',
        fromAmount: amount,
        destination: isEvmAddress(destination) ? destination : active,
        txHash,
        pendingCrossChain: chainId !== CUCK.chainId,
      });

      setState('done');
    } catch (err) {
      setState('error');
      setError(err?.message || 'Swap failed.');
    }
  };

  const expected = quoteBody
    ? formatUnits(quoteBody?.estimate?.toAmount || '0', quoteBody?.action?.toToken?.decimals ?? 18, 4)
    : '—';
  const routeName = quoteBody?.toolDetails?.name || quoteBody?.tool || 'LI.FI';

  if (!isEvmAddress(account)) {
    const injectedChoices = walletChoices.filter((choice, index, list) =>
      list.findIndex((item) => item.label === choice.label) === index
    );
    const hasInjectedMetaMask = injectedChoices.some((choice) => choice.label === 'MetaMask');
    const hasInjectedPhantom = injectedChoices.some((choice) => /phantom/i.test(choice.label));

    return (
      <section className="direct-swap mobile-connect-card">
        <div className="swap-heading">
          <strong>CHOOSE WALLET</strong>
          <span>Pick the wallet that holds the bag you want to recycle.</span>
        </div>

        <div className="wallet-choice-grid">
          {injectedChoices.map((choice) => (
            <button
              type="button"
              className="wallet-choice-button"
              key={choice.label}
              onClick={() => connectChoice(choice)}
            >
              <b>{choice.label}</b>
              <small>Connect this wallet</small>
            </button>
          ))}

          {!hasInjectedMetaMask ? (
            <button
              type="button"
              className="wallet-choice-button"
              onClick={connectMetaMask}
              disabled={state === 'connecting'}
            >
              <b>MetaMask</b>
              <small>{state === 'connecting' ? 'Opening…' : 'Mobile / extension'}</small>
            </button>
          ) : null}

          {!hasInjectedPhantom ? (
            <button
              type="button"
              className="wallet-choice-button"
              onClick={openCurrentDappInPhantom}
            >
              <b>Phantom</b>
              <small>Open this swap in Phantom</small>
            </button>
          ) : null}
        </div>

        <small className="mobile-connect-help">
          We never choose a wallet for you.
        </small>

        {error ? <div className="factory-finish-error">{error}</div> : null}
      </section>
    );
  }
  if (!token) {
    return (
      <section className="direct-swap">
        <div className="swap-heading">
          <strong>{holdingsLoading ? 'SCANNING WALLET…' : 'NO BAG SELECTED'}</strong>
          <span>Connected as {shortAddress(account)}. We only show balances we can actually verify.</span>
        </div>

        <div className="direct-wallet">
          <span>✓ {shortAddress(account)} · {walletLabel || 'Connected wallet'}</span>
          <button type="button" className="change-wallet-button" onClick={disconnectCurrent}>CHANGE WALLET</button>
        </div>

        {holdings.length ? (
          <div className="bag-picker">
            <span>YOUR BAGS</span>
            <div className="bag-picker-list">
              {holdings.slice(0, 8).map((item) => (
                <button type="button" key={item.id} onClick={() => onSelectHolding?.(item)}>
                  <b>{item.symbol}</b>
                  <small>{item.usd > 0 ? money(item.usd) : `${item.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })} · ${item.chainLabel}`}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="scan-status">
            {holdingsLoading
              ? 'Looking for balances across supported EVM chains…'
              : holdingsError
                ? `Token scan failed: ${holdingsError}`
                : 'No supported balance found for this address yet.'}
          </div>
        )}

        <small className="direct-note">
          We no longer default to Robinhood ETH when its balance is zero.
        </small>
      </section>
    );
  }


  return (
    <section className="direct-swap">
      <div className="swap-heading">
        <strong>RECYCLE {token.symbol}</strong>
        <span>{token.chainLabel} → $CUCK on Robinhood. One quote, one wallet transaction.</span>
      </div>

      <div className="direct-wallet">
        <span>✓ {shortAddress(account)} · {walletLabel || 'Connected wallet'}</span>
        <button type="button" className="change-wallet-button" onClick={disconnectCurrent}>CHANGE WALLET</button>
      </div>

      <div className="bag-picker">
        <span>YOUR BAGS</span>
        {holdingsLoading ? <small>Scanning wallet…</small> : null}

        {holdings.length ? (
          <div className="bag-picker-list">
            {holdings.slice(0, 8).map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === token.id ? 'active' : ''}
                onClick={() => onSelectHolding?.(item)}
              >
                <b>{item.symbol}</b>
                <small>{item.usd > 0 ? money(item.usd) : item.chainLabel}</small>
              </button>
            ))}
          </div>
        ) : (
          <small>
            {holdingsError ? 'Other bags could not be scanned. Showing Robinhood ETH directly.' : 'Robinhood ETH is available directly while we scan for other bags.'}
          </small>
        )}
      </div>

      <div className="direct-grid">
        <div className="direct-token-card"><span>FROM</span><strong>{token.symbol}</strong><small>{token.chainLabel}</small></div>
        <div className="direct-token-card output"><span>TO</span><strong>$CUCK</strong><small>Robinhood Chain · locked</small></div>
      </div>

      <label className="direct-amount">
        <span>AMOUNT</span>
        <div><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><b>{token.symbol}</b></div>
        <small className="available-balance">
          AVAILABLE: {Number(token.balance || 0).toLocaleString('en-US', { maximumFractionDigits: 8 })} {token.symbol}
          {token.usd > 0 ? ` · ${money(token.usd)}` : ''}
          {isNative ? ' · MAX keeps 5% for gas' : ''}
        </small>
      </label>

      <div className="direct-percent-row">
        <button type="button" onClick={() => setAmount(String(Number((token.balance * 0.25).toPrecision(10))))}>25%</button>
        <button type="button" onClick={() => setAmount(String(Number((token.balance * 0.50).toPrecision(10))))}>50%</button>
        <button type="button" onClick={() => setAmount(String(Number((token.balance * 0.75).toPrecision(10))))}>75%</button>
        <button type="button" onClick={() => setAmount(defaultRecycleAmount(token))}>MAX</button>
      </div>

      <div className="direct-quote">
        <span>YOU RECEIVE</span>
        <strong>{state === 'quoting' ? 'CHECKING…' : quoteBody ? `≈ ${expected} $CUCK` : '— $CUCK'}</strong>
        {quoteBody ? <small>Route found via {routeName} ✓</small> : null}
      </div>

      {error ? <div className="factory-finish-error">{error}</div> : null}

      <button
        type="button"
        className="direct-recycle"
        onClick={execute}
        disabled={!quoteBody || state === 'quoting' || state === 'executing' || state === 'done'}
      >
        {state === 'executing' ? 'CONFIRMING…' : state === 'done' ? 'SUBMITTED ✓' : 'SWAP → $CUCK'}
      </button>
      <small className="direct-note">Routing happens in the background. You only choose the bag and receive $CUCK.</small>
    </section>
  );
}

function SwapWidget({ destination, sourceToken, sourceForm, onQuote, onCompleted, onStarted, onWalletConnected, onRoutes, onFormChanged, onSourceSelected }) {
  const lockedDestination = isEvmAddress(destination);
  const outputToken = CUCK.address;

  const widgetConfig = useMemo(() => {
    const config = {
      appearance: 'dark',
      variant: 'compact',
      fromChain: sourceToken?.chainId ?? sourceForm?.chainId ?? undefined,
      fromToken: sourceToken?.tokenAddress ?? sourceForm?.tokenAddress ?? undefined,
      fromAmount: sourceForm?.fromAmount || undefined,

      // Force the actual user-facing destination: CUCK on Robinhood.
      toChain: CUCK.chainId,
      toToken: outputToken,
      formUpdateKey: `${sourceToken ? `source:${sourceToken.id}` : `source:${sourceForm?.chainId || 'none'}:${sourceForm?.tokenAddress || 'none'}`}:direct-cuck`,

      providers: [
        EthereumProvider({
          walletConnect: true,
          coinbase: true,
          metaMask: true,
          baseAccount: true,
        }),
        SolanaProvider(),
      ],

      chains: {
        types: { allow: [ChainType.EVM, ChainType.SVM] },
        to: { allow: [CUCK.chainId] },
      },

      tokens: {
        include: [{
          chainId: CUCK.chainId,
          address: CUCK.address,
          symbol: 'CUCK',
          name: 'The Cuck Factory',
          decimals: 18,
          coinKey: 'CUCK',
        }],
      },

      disabledUI: {
        toToken: true,
        ...(lockedDestination ? { toAddress: true } : {}),
      },

      hiddenUI: {
        appearance: true,
        language: true,
        reverseTokensButton: true,
        poweredBy: true,
      },

      // New keyPrefix prevents old per-user widget exchange settings from
      // carrying over from earlier test builds.
      keyPrefix: 'cuck-bag-recycler-v20',

      showSingleRoute: true,
      routePriority: 'RECOMMENDED',
      slippage: 0.03,

      theme: {
        colorSchemes: {
          dark: {
            palette: {
              primary: { main: '#b83b2d' },
              secondary: { main: '#e4b957' },
              background: { default: '#080402', paper: '#150a06' },
              text: { primary: '#fff0d1', secondary: '#b59c75' },
            },
          },
        },
        shape: { borderRadius: 3, borderRadiusSecondary: 3, borderRadiusTertiary: 3 },
        typography: { fontFamily: 'Arial, Helvetica, sans-serif' },
        container: {
          border: '0',
          borderRadius: '0',
          boxShadow: 'none',
          maxWidth: '100%',
        },
      },
    };

    if (lockedDestination) {
      config.toAddress = {
        name: 'Cuck Factory Employee Wallet',
        address: destination,
        chainType: ChainType.EVM,
      };
    }

    return config;
  }, [
    destination,
    lockedDestination,
    sourceToken,
    sourceForm?.chainId,
    sourceForm?.tokenAddress,
    sourceForm?.fromAmount,
    outputToken,
  ]);

  return (
    <section className="swap-section direct-lifi">
      <div className="swap-heading">
        <div>
          <span className="step-label">YOUR BAG</span>
          <strong>SWAP IT INTO $CUCK</strong>
        </div>
        <div className="locked-output">OUTPUT LOCKED · $CUCK</div>
      </div>

      <EventBridge
        onQuote={onQuote}
        onCompleted={onCompleted}
        onStarted={onStarted}
        onWalletConnected={onWalletConnected}
        onRoutes={onRoutes}
        onFormChanged={onFormChanged}
        onSourceSelected={onSourceSelected}
      />

      <LiFiWidget integrator="cuckfactory" config={widgetConfig} />

      <div className="swap-promise">
        <span>$CUCK stays yours.</span>
        <b>Extra Cuckdrop value goes on top.</b>
      </div>
    </section>
  );
}
function DirectLiFiQuoteFallback({
  sourceForm,
  wallet,
  destination,
  selectedHolding,
  onFinished,
}) {
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  const chainId = Number(sourceForm?.chainId || selectedHolding?.chainId || 0);
  const tokenAddress = sourceForm?.tokenAddress || selectedHolding?.tokenAddress || ROUTING.robinhoodNativeToken;
  const amount = String(sourceForm?.fromAmount || '');
  const recipient = isEvmAddress(destination) ? destination : wallet;

  useEffect(() => {
    if (
      chainId !== CUCK.chainId ||
      !isEvmAddress(wallet) ||
      !isEvmAddress(recipient) ||
      !Number(amount || 0)
    ) {
      setQuote(null);
      setState('idle');
      return;
    }

    let cancelled = false;

    (async () => {
      setState('loading');
      setError('');
      setQuote(null);

      try {
        const decimals = (
          !tokenAddress ||
          sameAddress(tokenAddress, ROUTING.robinhoodNativeToken) ||
          sameAddress(tokenAddress, ROUTING.kyberNativeToken)
        ) ? 18 : await evmTokenDecimals(tokenAddress);

        const rawAmount = decimalToRaw(amount, decimals);
        if (!rawAmount || rawAmount === '0') throw new Error('Choose an amount first.');

        const params = new URLSearchParams({
          fromChain: String(CUCK.chainId),
          toChain: String(CUCK.chainId),
          fromToken: tokenAddress || ROUTING.robinhoodNativeToken,
          toToken: CUCK.address,
          fromAmount: rawAmount,
          fromAddress: wallet,
          toAddress: recipient,
          slippage: '0.03',
          integrator: 'cuckfactory',
        });

        const response = await fetch(`https://li.quest/v1/quote?${params.toString()}`);
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.transactionRequest) {
          const message = body?.message || body?.error?.message || `LI.FI quote failed (${response.status})`;
          throw new Error(message);
        }

        if (cancelled) return;
        setQuote(body);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Direct LI.FI quote unavailable.');
        setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [chainId, tokenAddress, amount, wallet, recipient]);

  const execute = async () => {
    if (!quote?.transactionRequest || !isEvmAddress(wallet)) return;

    setState('executing');
    setError('');

    try {
      const provider = window.ethereum;
      if (!provider?.request) throw new Error('No EVM wallet detected.');

      await ensureRobinhoodWallet(provider);

      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const account = accounts?.[0] || '';
      if (!isEvmAddress(account)) throw new Error('No EVM wallet connected.');
      if (account.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`Connect ${shortAddress(wallet)} to execute this quote.`);
      }

      const isNative = (
        !tokenAddress ||
        sameAddress(tokenAddress, ROUTING.robinhoodNativeToken) ||
        sameAddress(tokenAddress, ROUTING.kyberNativeToken)
      );

      const approvalAddress = quote?.estimate?.approvalAddress;
      if (!isNative && isEvmAddress(approvalAddress)) {
        const decimals = await evmTokenDecimals(tokenAddress);
        const rawAmount = BigInt(decimalToRaw(amount, decimals));
        const allowance = await erc20Allowance(tokenAddress, account, approvalAddress);
        if (allowance < rawAmount) {
          await approveErc20(provider, account, tokenAddress, approvalAddress, rawAmount);
        }
      }

      const req = quote.transactionRequest;
      const tx = {
        from: account,
        to: req.to,
        data: req.data || '0x',
        value: req.value || '0x0',
      };

      if (req.gasLimit) tx.gas = req.gasLimit;
      else if (req.gas) tx.gas = req.gas;
      if (req.gasPrice) tx.gasPrice = req.gasPrice;
      if (req.maxFeePerGas) tx.maxFeePerGas = req.maxFeePerGas;
      if (req.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = req.maxPriorityFeePerGas;

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [tx],
      });

      await waitForReceipt(txHash);

      const toDecimals = quote?.action?.toToken?.decimals ?? 18;
      const toAmount = quote?.estimate?.toAmount || '0';
      const fromUsd = Number(quote?.action?.fromToken?.priceUSD || 0) * Number(amount || 0);
      const toHuman = Number(formatUnits(toAmount, toDecimals, 10));
      const toUsd = Number(quote?.action?.toToken?.priceUSD || 0) * toHuman;

      onFinished?.({
        fromUsd,
        toUsd: toUsd || fromUsd,
        cuckAmount: formatUnits(toAmount, toDecimals, 4),
        fromSymbol: quote?.action?.fromToken?.symbol || selectedHolding?.symbol || 'TOKEN',
        fromAmount: amount,
        destination: recipient,
        txHash,
      });

      setState('done');
    } catch (err) {
      setError(err?.message || 'Swap failed.');
      setState('error');
    }
  };

  if (state === 'idle') return null;

  const toDecimals = quote?.action?.toToken?.decimals ?? 18;
  const toAmount = quote?.estimate?.toAmount || '0';
  const expected = quote ? formatUnits(toAmount, toDecimals, 4) : '—';
  const toolName = quote?.toolDetails?.name || quote?.tool || 'LI.FI';

  return (
    <section className="direct-quote-fallback">
      <span className="fallback-kicker">DIRECT LI.FI QUOTE</span>

      {state === 'loading' ? (
        <strong>Checking the route directly…</strong>
      ) : quote ? (
        <>
          <div className="fallback-found">
            <div>
              <small>ROUTE FOUND</small>
              <strong>≈ {expected} $CUCK</strong>
            </div>
            <span>via {toolName}</span>
          </div>

          <button
            type="button"
            className="fallback-swap"
            onClick={execute}
            disabled={state === 'executing' || state === 'done'}
          >
            {state === 'executing' ? 'SWAPPING…' : state === 'done' ? 'RECYCLED ✓' : 'SWAP → $CUCK'}
          </button>
        </>
      ) : (
        <strong>{error || 'No direct quote found.'}</strong>
      )}

      {error && quote ? <small className="fallback-error">{error}</small> : null}
    </section>
  );
}

function buildReferralLink(referralCode) {
  if (!referralCode) return '';
  const isGithub = window.location.hostname.endsWith('github.io');
  const base = isGithub
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://cucks.money/recycle';
  return `${base}?ref=${encodeURIComponent(referralCode)}`;
}

function getOrCreateTemporaryReferralCode() {
  try {
    const storageKey = 'cuck_factory_temp_recycle_ref';
    const saved = window.localStorage.getItem(storageKey);
    if (saved) return saved;

    const bytes = new Uint8Array(4);
    window.crypto?.getRandomValues?.(bytes);
    const raw = Array.from(bytes).map((n) => n.toString(36)).join('').toUpperCase().slice(0, 6);
    const fallback = Math.random().toString(36).slice(2, 8).toUpperCase();
    const code = `TMP-${raw || fallback}`;
    window.localStorage.setItem(storageKey, code);
    return code;
  } catch {
    return `TMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }
}

function Success({ result, destination, employeeId, referralCode, referredBy, demo }) {
  const baseCp = bonusForUsd(result.fromUsd);
  const referralExtraCp = referredBy ? Math.round(baseCp * REFERRAL.referredUserBonusRate) : 0;
  const recycleCp = baseCp + referralExtraCp;
  const recycleDropUsd = dropValueForCp(recycleCp);
  const postBonusCp = Math.round(baseCp * REFERRAL.postBonusRate);
  const postBonusUsd = dropValueForCp(postBonusCp);
  const recruiterCp = Math.round(baseCp * REFERRAL.recruiterBonusRate);
  const cuckAmount = result.cuckAmount || '—';
  const fromSymbol = result.fromSymbol || 'TOKEN';
  const sourceUsd = result.fromUsd > 0 ? result.fromUsd : 0;
  const receivedUsd = result.toUsd > 0 ? result.toUsd : sourceUsd;
  const holdDestination = result.destination || destination;
  const [temporaryReferralCode] = useState(() => getOrCreateTemporaryReferralCode());
  const shareReferralCode = referralCode || temporaryReferralCode;
  const referralLink = buildReferralLink(shareReferralCode);
  const isTemporaryReferral = !referralCode;
  const [postOpened, setPostOpened] = useState(false);
  const [postVerified, setPostVerified] = useState(false);

  const shareText = [
    `Recycled ${money(sourceUsd)} of dead $${fromSymbol} into $CUCK.`,
    `Kept the ~${money(receivedUsd)} in $CUCK and got another ~${money(recycleDropUsd)} in Cuckdrop value on top.`,
    '',
    referralLink
      ? `Use my link and you get +20% extra Cuck Power too:\n${referralLink}`
      : 'Recycle yours at cucks.money',
  ].join('\n');

  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  const totalCp = recycleCp + (postVerified ? postBonusCp : 0);
  const totalDropUsd = dropValueForCp(totalCp);

  return (
    <section className="success" id="success">
      <span className="micro">BAG RECYCLED</span>
      <h2>{money(receivedUsd)} IN $CUCK</h2>

      <div className="earned-card">
        <span>RECYCLING BONUS</span>
        <strong>+≈ {money(recycleDropUsd)} CUCKDROP VALUE</strong>
        <small>+{recycleCp.toLocaleString('en-US')} Cuck Power{referredBy ? ' · includes your +20% referral boost' : ''}</small>
      </div>

      <div className="post-card">
          <span className="post-kicker">WANT MORE?</span>
          <h3>POST THIS → +25% MORE CUCK POWER</h3>
          <p>Your post already contains a recycle referral link. Anyone — new or already registered — who uses it gets +20% extra Recycling Cuck Power.</p>
          {isTemporaryReferral ? (
            <div className="temp-ref">TEMP REFERRAL ACTIVE · {shareReferralCode} · CLAIM IT WHEN YOU CREATE YOUR EMPLOYEE RECORD</div>
          ) : null}
          <a
            className="x-button"
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setPostOpened(true)}
          >
            POST MY RECYCLE ON X ↗
          </a>
          <div className="post-reward-row">
            <span>POST BONUS</span>
            <b>+{postBonusCp.toLocaleString('en-US')} CP · ≈ {money(postBonusUsd)}</b>
          </div>
          {postOpened && !postVerified ? (
            <div className="post-pending">
              <span>Post opened. On cucks.money the connected X account can be verified automatically.</span>
              {demo ? <button type="button" onClick={() => setPostVerified(true)}>SIMULATE X VERIFIED</button> : null}
            </div>
          ) : null}
          {postVerified ? <div className="verified">✓ X post verified · total bonus now {totalCp.toLocaleString('en-US')} CP (≈ {money(totalDropUsd)})</div> : null}
        </div>

      {!employeeId ? (
        <div className="employee-cta">
          <strong>BONUS RESERVED · YOUR SHARE LINK ALREADY WORKS.</strong>
          <span>Your temporary referral is active now. Create your Employee Record to claim it permanently and activate your Cuck Power.</span>
          <a href="https://cucks.money/" target="_blank" rel="noreferrer">CREATE EMPLOYEE RECORD ↗</a>
        </div>
      ) : null}

      <div className="hold-rule">
        <b>ONE RULE</b>
        <span>Keep the recycled {cuckAmount !== '—' ? `${cuckAmount} ` : ''}$CUCK{holdDestination ? ` in ${shortAddress(holdDestination)}` : ''} until the Cuckdrop. Drop below that amount and the Recycling, referral and post bonuses disappear.</span>
      </div>

      {referredBy ? (
        <div className="referral-note">
          <b>REFERRAL USED ✓</b>
          <span>You received +20% extra Recycling Cuck Power — this works whether you are new or already an Employee. Your referrer earns +{recruiterCp.toLocaleString('en-US')} recruiter CP (40% of the base recycle bonus) when this recycle is verified and held.</span>
        </div>
      ) : null}
    </section>
  );
}

function FactoryFinish({ gatewayResult, onFinished }) {
  const [route, setRoute] = useState(null);
  const [cuckDecimals, setCuckDecimals] = useState(18);
  const [state, setState] = useState('quoting');
  const [error, setError] = useState('');

  const recipient = gatewayResult?.destination || '';
  const amountInRaw = gatewayResult?.amountInRaw || '0';

  useEffect(() => {
    if (!gatewayResult || !amountInRaw || amountInRaw === '0') return;
    let cancelled = false;
    setState('quoting');
    setError('');
    Promise.all([
      findBestFactoryRoute(ROUTING.robinhoodNativeToken, amountInRaw),
      evmTokenDecimals(CUCK.address),
    ]).then(([found, decimals]) => {
      if (cancelled) return;
      if (!found) throw new Error('The Factory could not find the Robinhood ETH → $CUCK route.');
      setRoute(found);
      setCuckDecimals(decimals);
      setState('ready');
    }).catch((err) => {
      if (cancelled) return;
      setError(err?.message || 'Factory quote unavailable');
      setState('error');
    });
    return () => { cancelled = true; };
  }, [gatewayResult, amountInRaw]);

  if (!gatewayResult) return null;
  const humanEth = formatUnits(amountInRaw, 18, 6);
  const humanCuck = route ? formatUnits(route.amountOut.toString(), cuckDecimals, 4) : '—';

  const execute = async () => {
    if (!isEvmAddress(recipient)) {
      setError('Connect the EVM wallet that received the bridged ETH.');
      setState('error');
      return;
    }
    setState('executing');
    setError('');
    try {
      // Leave a small buffer for bridge variance and gas if needed.
      const raw = BigInt(amountInRaw);
      const safeAmount = raw * 9950n / 10000n;
      const before = await cuckBalance(recipient);
      const execution = await executeFactoryDirect({
        tokenAddress: ROUTING.robinhoodNativeToken,
        amountInRaw: safeAmount.toString(),
        recipient,
        expectedSourceAccount: recipient,
      });
      const after = await cuckBalance(recipient);
      const beforeRaw = before?.raw ?? 0n;
      const afterRaw = after?.raw ?? 0n;
      const diff = afterRaw > beforeRaw ? afterRaw - beforeRaw : execution.quotedOut;
      const decimals = after?.decimals ?? before?.decimals ?? cuckDecimals;
      onFinished({
        fromUsd: gatewayResult.fromUsd,
        toUsd: gatewayResult.toUsd || gatewayResult.fromUsd,
        cuckAmount: formatUnits(diff.toString(), decimals, 4),
        fromSymbol: gatewayResult.fromSymbol,
        fromAmount: gatewayResult.fromAmount,
        destination: recipient,
        finishTxHash: execution.txHash,
      });
      setState('done');
    } catch (err) {
      setError(err?.message || 'Final Factory swap failed');
      setState('error');
    }
  };

  return (
    <section className="factory-finish" id="factory-finish">
      <span className="smart-kicker">VALUE ARRIVED ON ROBINHOOD ✓</span>
      <h3>ONE LAST CLICK → $CUCK</h3>
      <div className="factory-finish-flow"><div><span>ARRIVED</span><strong>{humanEth} ETH</strong></div><b>→</b><div><span>YOU RECEIVE</span><strong>{humanCuck} $CUCK</strong></div></div>
      <p>The Factory found the Robinhood liquidity path. Internal routing assets remain hidden.</p>
      {state === 'quoting' ? <div className="factory-finish-status"><span className="pulse" /> CHECKING FACTORY LIQUIDITY…</div> : null}
      {error ? <div className="factory-finish-error">{error}</div> : null}
      <button type="button" className="smart-primary" onClick={execute} disabled={state === 'quoting' || state === 'executing' || state === 'done' || !route}>{state === 'executing' ? 'CONFIRMING → $CUCK…' : state === 'done' ? 'BAG RECYCLED ✓' : 'FINISH → $CUCK'}</button>
    </section>
  );
}

function RouteNotice({ routeState, sourceForm }) {
  if (Number(sourceForm?.fromAmount || 0) <= 0 || routeState !== 'no-route') return null;
  return (
    <section className="smart-router warning">
      <span className="smart-kicker">THIS BAG IS TOO SMALL OR HAS NO BRIDGE ROUTE YET</span>
      <strong>TRY A LARGER AMOUNT — OR SAVE IT FOR BATCH RECYCLING.</strong>
      <p>Nothing has been submitted. Cross-chain dust can cost more to move than it is worth.</p>
    </section>
  );
}

function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const prefilled = params.get('wallet') || window.__CUCK_EMPLOYEE_WALLET__ || '';
  const employeeId = params.get('employee') || window.__CUCK_EMPLOYEE_ID__ || '';
  const referralCode = params.get('refcode') || window.__CUCK_REFERRAL_CODE__ || '';
  const incomingReferral = params.get('ref') || '';
  const referredBy = incomingReferral && incomingReferral !== referralCode ? incomingReferral : '';
  const demo = params.get('demo') === '1';

  const destination = isEvmAddress(prefilled) ? prefilled : '';
  const [quote, setQuote] = useState(null);
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [wallets, setWallets] = useState({ evmAddress: '', solanaAddress: '' });
  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState('');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [routeState, setRouteState] = useState('idle');
  const [sourceForm, setSourceForm] = useState({ chainId: null, tokenAddress: '', fromAmount: '' });
  const [gatewayResult, setGatewayResult] = useState(null);
  const [crossChainMode, setCrossChainMode] = useState(false);
  const [walletConnectError, setWalletConnectError] = useState('');

  const handleWalletConnected = (payload) => {
    const address = payload?.address || '';
    if (!address) return;
    setWallets((current) => ({
      ...current,
      ...(isEvmAddress(address) ? { evmAddress: address } : {}),
      ...(looksLikeSolanaAddress(address) ? { solanaAddress: address } : {}),
    }));
  };

  const handleWalletDisconnected = () => {
    setWallets({ evmAddress: '', solanaAddress: '' });
    setHoldings([]);
    setHoldingsError('');
    setHoldingsLoading(false);
    setSelectedHolding(null);
    setSourceForm({ chainId: null, tokenAddress: '', fromAmount: '' });
    setQuote(null);
    setResult(null);
    setStatus('idle');
  };

  const connectForScan = async () => {
    setWalletConnectError('');
    try {
      const discovered = await discoverEvmWallets();
      const provider = discovered.find((item) => item.label === 'MetaMask')?.provider || discovered[0]?.provider;
      if (!provider?.request) throw new Error('No EVM wallet detected. Use another wallet below instead.');
      await ensureRobinhoodWallet(provider);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0] || '';
      if (!isEvmAddress(address)) throw new Error('No EVM wallet connected.');
      handleWalletConnected({ address });
    } catch (err) {
      setWalletConnectError(err?.message || 'Wallet connection failed.');
    }
  };

  useEffect(() => {
    const connected = isEvmAddress(wallets.evmAddress) || looksLikeSolanaAddress(wallets.solanaAddress);
    if (!connected) return;
    let cancelled = false;
    setHoldingsLoading(true);
    setHoldingsError('');
    scanConnectedWallet(wallets)
      .then((items) => {
        if (cancelled) return;
        setHoldings(items);

        // First successful scan: put the best leftover straight into the widget.
        if (items.length) {
          setSelectedHolding((current) => {
            if (current) return current;
            const first = items[0];
            setSourceForm({
              chainId: first.chainId,
              tokenAddress: first.tokenAddress,
              fromAmount: defaultRecycleAmount(first),
            });
            return first;
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setHoldings([]);
        setHoldingsError(error?.message || 'Wallet scan unavailable');
      })
      .finally(() => {
        if (!cancelled) setHoldingsLoading(false);
      });
    return () => { cancelled = true; };
  }, [wallets.evmAddress, wallets.solanaAddress]);

  const handleHoldingSelected = (holding) => {
    setSelectedHolding(holding);
    setQuote(null);
    setRouteState('idle');
    setGatewayResult(null);
    setResult(null);
    setCrossChainMode(false);
    setSourceForm({
      chainId: holding.chainId,
      tokenAddress: holding.tokenAddress,
      fromAmount: defaultRecycleAmount(holding),
    });
    window.setTimeout(() => document.getElementById('swap-widget')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  };

  const handleRoutes = (routes) => {
    if (Array.isArray(routes) && routes.length) {
      setRouteState('available');
      return;
    }
    if (Number(sourceForm.fromAmount || 0) > 0 && sourceForm.chainId && sourceForm.tokenAddress) {
      setRouteState('no-route');
    }
  };

  const handleFormChanged = (payload) => {
    if (!payload?.fieldName) return;
    const field = payload.fieldName;
    const value = payload.newValue;

    if (field === 'fromAmount') {
      setSourceForm((current) => ({ ...current, fromAmount: String(value ?? '') }));
      setRouteState('idle');
      setGatewayResult(null);
      setResult(null);
      return;
    }

    if (field === 'fromChain') {
      const chainId = Number(value?.id ?? value?.chainId ?? value ?? 0) || null;
      setSourceForm((current) => ({ ...current, chainId }));
      setRouteState('idle');
      return;
    }

    if (field === 'fromToken') {
      const tokenAddress = value?.address ?? value?.tokenAddress ?? (typeof value === 'string' ? value : '');
      const chainId = Number(value?.chainId ?? 0) || null;
      setSourceForm((current) => ({
        ...current,
        tokenAddress: tokenAddress || current.tokenAddress,
        chainId: chainId || current.chainId,
      }));
      setRouteState('idle');
    }
  };

  const handleSourceSelected = (payload) => {
    if (!payload) return;
    setSourceForm((current) => ({
      ...current,
      chainId: Number(payload.chainId || current.chainId || 0) || null,
      tokenAddress: payload.tokenAddress || current.tokenAddress || '',
    }));
    setRouteState('idle');
    setGatewayResult(null);
    setResult(null);
  };

  const handleQuote = (route) => {
    const fromUsd = getRouteUsd(route, 'from');
    const toUsd = getRouteUsd(route, 'to');
    if (fromUsd > 0 || toUsd > 0) {
      setQuote({ fromUsd, toUsd });
      setRouteState('available');
    }
  };

  const handleStarted = (route) => {
    setStatus('swapping');
    setGatewayResult(null);
    handleQuote(route);
  };

  const handleCompleted = (route) => {
    const fromUsd = getRouteUsd(route, 'from');
    const toUsd = getRouteUsd(route, 'to');
    const fromSymbol = route?.fromToken?.symbol || selectedHolding?.symbol || 'TOKEN';
    const fromAmount = formatUnits(route?.fromAmount, route?.fromToken?.decimals ?? 18, 6);
    const routeDestination = typeof route?.toAddress === 'string'
      ? route.toAddress
      : (route?.toAddress?.address || destination || wallets.evmAddress || '');

    const cuckAmount = formatUnits(
      route?.toAmount,
      route?.toToken?.decimals ?? 18,
      4,
    );

    setQuote({ fromUsd, toUsd });
    setResult({
      fromUsd,
      toUsd,
      cuckAmount,
      fromSymbol,
      fromAmount,
      destination: routeDestination,
    });
    setStatus('done');

    window.setTimeout(() => {
      document.getElementById('success')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  const handleFactoryFinished = (finalResult) => {
    setResult(finalResult);
    setStatus('done');
    window.setTimeout(() => document.getElementById('success')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  const simulate = () => {
    setQuote({ fromUsd: 8, toUsd: 7.96 });
    setResult({
      fromUsd: 8,
      toUsd: 7.88,
      cuckAmount: '38421.72',
      fromSymbol: 'BASECAT',
      fromAmount: '125000',
      destination: destination || '0x5231b49adfeb43ac6c69caa08482f55b075a6eed',
    });
    setStatus('done');
    window.setTimeout(() => document.getElementById('success')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  return (
    <div className="site-shell">
      <header className="brand-bar">
        <a href="https://cucks.money/" className="brand">THE CUCK FACTORY</a>
        <span>BAG RECYCLING</span>
      </header>

      <main>
        <section className="hero">
          <span className="micro">FACTORY SERVICE № 05</span>
          <h1>YOUR BAG IS FUCKED.<br /><em>MAKE WHAT'S LEFT PAY.</em></h1>
          <p>Turn a supported leftover token into $CUCK.</p>
          <b>The Factory adds extra Cuckdrop value on top.</b>
        </section>

        <DealCard quote={quote} referredBy={referredBy} />

        {referredBy ? <div className="ref-active">↗ REFERRAL ACTIVE · YOU GET +20% EXTRA RECYCLING CUCK POWER</div> : null}
        <EmployeeLine destination={destination} employeeId={employeeId} />

        <section className="recycle-machine">
          <div className="machine-head">
            <div>
              <span>ONE SWAP</span>
              <strong>ANY SUPPORTED EVM BAG → $CUCK</strong>
            </div>
            <b>+$CUCKDROP VALUE</b>
          </div>


          <div id="swap-widget">
            <DirectEvmCuckSwap
              destination={destination}
              wallet={wallets.evmAddress}
              sourceToken={selectedHolding && Number(selectedHolding.chainId) !== Number(ALCHEMY_NETWORKS['sol-mainnet'].chainId) ? selectedHolding : null}
              holdings={holdings.filter((item) => Number(item.chainId) !== Number(ALCHEMY_NETWORKS['sol-mainnet'].chainId))}
              holdingsLoading={holdingsLoading}
              holdingsError={holdingsError}
              onSelectHolding={handleHoldingSelected}
              onWalletConnected={handleWalletConnected}
              onWalletDisconnected={handleWalletDisconnected}
              onQuote={setQuote}
              onFinished={handleFactoryFinished}
            />
          </div>
        </section>

        {status === 'swapping' ? (
          <div className="status-line"><span className="pulse" /> RECYCLING YOUR BAG…</div>
        ) : null}
        {demo ? <button className="demo-button" type="button" onClick={simulate}>SIMULATE $8 BASECAT RECYCLE</button> : null}

        {result ? (
          <Success
            result={result}
            destination={destination}
            employeeId={employeeId}
            referralCode={referralCode}
            referredBy={referredBy}
            demo={demo}
          />
        ) : null}
      </main>

      <footer>
        <span>THE CUCK FACTORY</span>
        <span>SWAP ONCE · RECEIVE $CUCK · KEEP THE BONUS</span>
      </footer>
      <div className="prototype-note">Prototype economics: ${CUCKDROP_USD_PER_CP.toFixed(3)} estimated Cuckdrop value / CP. Final values come from the live Factory backend.</div>
    </div>
  );
}


createRoot(document.getElementById('root')).render(<App />);
