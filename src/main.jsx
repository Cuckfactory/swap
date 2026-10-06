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
  'sol-mainnet': { chainId: 1151111081099710, label: 'Solana', nativeAddress: '11111111111111111111111111111111' },
};

const EVM_SCAN_BATCHES = [
  ['eth-mainnet', 'base-mainnet', 'arb-mainnet', 'opt-mainnet', 'bnb-mainnet'],
  ['polygon-mainnet', 'avax-mainnet', 'linea-mainnet', 'scroll-mainnet', 'blast-mainnet'],
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
  const response = await fetch(ROUTING.robinhoodRpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Robinhood RPC failed (${response.status})`);
  const json = await response.json();
  if (json?.error) throw new Error(json.error.message || 'Robinhood RPC error');
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

const FACTORY_FINAL_PATH = v3Path(
  [FACTORY_ROUTE.gatewayToken.address, FACTORY_ROUTE.hoodToken, CUCK.address],
  [FACTORY_ROUTE.usdGToHoodFee, FACTORY_ROUTE.hoodToCuckFee],
);

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
        rpcUrls: [ROUTING.robinhoodRpc],
        blockExplorerUrls: ['https://robinhoodchain.blockscout.com/'],
      }],
    });
  }
}

async function quoteFactoryFinish(amountInRaw) {
  const data = encodeFunctionData({
    abi: QUOTER_ABI,
    functionName: 'quoteExactInput',
    args: [FACTORY_FINAL_PATH, BigInt(amountInRaw)],
  });
  const result = await rpcCall('eth_call', [{ to: FACTORY_ROUTE.quoterV2, data }, 'latest']);
  const decoded = decodeFunctionResult({ abi: QUOTER_ABI, functionName: 'quoteExactInput', data: result });
  const amountOut = Array.isArray(decoded) ? decoded[0] : decoded;
  return BigInt(amountOut || 0);
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

async function executeFactoryFinish({ amountInRaw, recipient }) {
  const provider = window.ethereum;
  if (!provider?.request) throw new Error('Open this page in an EVM wallet browser or enable MetaMask.');
  await ensureRobinhoodWallet(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const account = accounts?.[0];
  if (!isEvmAddress(account)) throw new Error('No EVM wallet connected.');
  if (recipient && account.toLowerCase() !== recipient.toLowerCase()) {
    throw new Error(`Connect the receiving wallet ${shortAddress(recipient)} to finish the recycle.`);
  }

  const amount = BigInt(amountInRaw);
  const allowance = await erc20Allowance(FACTORY_ROUTE.gatewayToken.address, account, FACTORY_ROUTE.swapRouter02);
  if (allowance < amount) {
    await approveErc20(provider, account, FACTORY_ROUTE.gatewayToken.address, FACTORY_ROUTE.swapRouter02, amount);
  }

  const quotedOut = await quoteFactoryFinish(amount);
  if (quotedOut <= 0n) throw new Error('The Factory route could not quote USDG → CUCK.');
  const minOut = quotedOut * BigInt(10000 - FACTORY_ROUTE.finalSlippageBps) / 10000n;
  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInput',
    args: [{
      path: FACTORY_FINAL_PATH,
      recipient: account,
      amountIn: amount,
      amountOutMinimum: minOut,
    }],
  });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: account, to: FACTORY_ROUTE.swapRouter02, data, value: '0x0' }],
  });
  await waitForReceipt(txHash);
  return { txHash, quotedOut, recipient: account };
}

async function findKyberRobinhoodRoute({ tokenIn, amountHuman, origin }) {
  if (!tokenIn || !amountHuman || Number(amountHuman) <= 0) return null;
  const input = tokenIn === ROUTING.robinhoodNativeToken ? ROUTING.kyberNativeToken : tokenIn;
  const decimals = tokenIn === ROUTING.robinhoodNativeToken ? 18 : await evmTokenDecimals(input);
  const amountIn = decimalToRaw(amountHuman, decimals);
  if (amountIn === '0') return null;
  const url = new URL(ROUTING.kyberRoutesUrl);
  url.searchParams.set('tokenIn', input);
  url.searchParams.set('tokenOut', CUCK.address);
  url.searchParams.set('amountIn', amountIn);
  url.searchParams.set('gasInclude', 'true');
  if (isEvmAddress(origin)) url.searchParams.set('origin', origin);
  const response = await fetch(url, { headers: { 'x-client-id': ROUTING.kyberClientId } });
  if (!response.ok) return null;
  const json = await response.json();
  const summary = json?.data?.routeSummary;
  if (!summary?.amountOut) return null;
  return {
    amountInUsd: Number(summary.amountInUsd || 0),
    amountOutUsd: Number(summary.amountOutUsd || 0),
    amountOut: summary.amountOut,
    amountIn,
    routeSummary: summary,
    routerAddress: json?.data?.routerAddress || '',
  };
}

async function buildKyberRobinhoodSwap({ routeSummary, sender, recipient }) {
  const response = await fetch(ROUTING.kyberBuildUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-id': ROUTING.kyberClientId,
    },
    body: JSON.stringify({
      routeSummary,
      sender,
      origin: sender,
      recipient,
      slippageTolerance: Math.round((FACTORY_ROUTE.finalSlippageBps || 300)),
      deadline: Math.floor(Date.now() / 1000) + 1200,
      enableGasEstimation: true,
      source: 'cuck-factory-bag-recycler',
    }),
  });
  if (!response.ok) throw new Error(`Factory route build failed (${response.status})`);
  const json = await response.json();
  const data = json?.data;
  if (!data?.data || !data?.routerAddress) throw new Error('Factory route could not be built.');
  return data;
}

async function executeKyberRobinhoodSwap({ route, tokenIn, sender, recipient }) {
  const provider = window.ethereum;
  if (!provider?.request) throw new Error('Open this page in an EVM wallet browser or enable MetaMask.');
  await ensureRobinhoodWallet(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const account = accounts?.[0];
  if (!isEvmAddress(account)) throw new Error('No EVM wallet connected.');
  if (sender && account.toLowerCase() !== sender.toLowerCase()) {
    throw new Error(`Connect ${shortAddress(sender)} to recycle this bag.`);
  }

  const input = tokenIn === ROUTING.robinhoodNativeToken ? ROUTING.kyberNativeToken : tokenIn;
  if (tokenIn !== ROUTING.robinhoodNativeToken) {
    const spender = route.routerAddress;
    const allowance = await erc20Allowance(tokenIn, account, spender);
    const amount = BigInt(route.routeSummary.amountIn || route.amountIn || 0);
    if (allowance < amount) await approveErc20(provider, account, tokenIn, spender, amount);
  }

  const built = await buildKyberRobinhoodSwap({
    routeSummary: route.routeSummary,
    sender: account,
    recipient: isEvmAddress(recipient) ? recipient : account,
  });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: account,
      to: built.routerAddress,
      data: built.data,
      value: built.transactionValue ? `0x${BigInt(built.transactionValue).toString(16)}` : '0x0',
    }],
  });
  await waitForReceipt(txHash);
  return { txHash, quotedOut: BigInt(route.amountOut || route.routeSummary.amountOut || 0) };
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

async function scanConnectedWallet({ evmAddress, solanaAddress }) {
  const jobs = [];
  if (isEvmAddress(evmAddress)) {
    EVM_SCAN_BATCHES.forEach((networks) => jobs.push(fetchAlchemyTokenBatch(evmAddress, networks)));
  }
  if (looksLikeSolanaAddress(solanaAddress)) {
    jobs.push(fetchAlchemyTokenBatch(solanaAddress, ['sol-mainnet']));
  }
  if (!jobs.length) return [];
  const settled = await Promise.allSettled(jobs);
  const holdings = settled
    .flatMap((item) => item.status === 'fulfilled' ? item.value : [])
    .map(normalizeHolding)
    .filter(Boolean)
    .filter((item) => item.usd >= 0.25)
    .sort((a, b) => leftoverRank(a.usd) - leftoverRank(b.usd) || b.usd - a.usd);
  const seen = new Set();
  return holdings.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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
  if (!connected && !loading) {
    return (
      <div className="wallet-finder teaser">
        <span className="wallet-finder-kicker">FASTEST WAY IN</span>
        <strong>CONNECT A WALLET. WE'LL FIND THE LEFTOVERS.</strong>
        <small>Your actual token balances show up here. Pick one and jump straight into the swap.</small>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="wallet-finder scanning">
        <span className="pulse" /> SCANNING YOUR WALLET FOR LEFTOVERS…
      </div>
    );
  }
  if (error) {
    return (
      <div className="wallet-finder error">
        <strong>COULDN'T SCAN THIS WALLET AUTOMATICALLY.</strong>
        <small>No problem — use the normal token search below.</small>
      </div>
    );
  }
  if (!holdings.length) {
    return (
      <div className="wallet-finder empty">
        <strong>NO ROUTABLE LEFTOVERS FOUND IN THE SCAN.</strong>
        <small>You can still search any supported token manually below.</small>
      </div>
    );
  }
  const visible = showAll ? holdings : holdings.slice(0, 5);
  return (
    <section className="wallet-finder found">
      <div className="wallet-finder-head">
        <div>
          <span className="wallet-finder-kicker">FOUND IN YOUR WALLET</span>
          <strong>PICK THE BAG YOU WANT TO RECYCLE.</strong>
        </div>
        <small>Small leftovers first</small>
      </div>
      <div className="holding-list">
        {visible.map((item) => {
          const active = selected?.id === item.id;
          return (
            <button key={item.id} type="button" className={`holding-row ${active ? 'active' : ''}`} onClick={() => onRecycle(item)}>
              <span className="holding-logo">
                {item.logo ? <img src={item.logo} alt="" /> : <b>{item.symbol.slice(0, 1)}</b>}
              </span>
              <span className="holding-main">
                <b>${item.symbol}</b>
                <small>{item.chainLabel}</small>
              </span>
              <span className="holding-value">
                <b>{money(item.usd)}</b>
                <small>{item.balance.toLocaleString('en-US', { maximumFractionDigits: 5 })} {item.symbol}</small>
              </span>
              <span className="holding-action">{active ? 'SELECTED ✓' : 'RECYCLE →'}</span>
            </button>
          );
        })}
      </div>
      {holdings.length > 5 ? (
        <button className="show-holdings" type="button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'SHOW FEWER' : `SHOW ${holdings.length - 5} MORE`}
        </button>
      ) : null}
      <div className="wallet-finder-foot">Not seeing a token? Use the full LI.FI search below.</div>
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
  const fallback = {
    id: 'robinhood-native-eth',
    chainId: FACTORY_ROUTE.bridgeToken.chainId,
    chainLabel: 'Robinhood Chain',
    tokenAddress: ROUTING.robinhoodNativeToken,
    symbol: 'ETH',
    decimals: 18,
    balance: 0,
    usd: 0,
  };
  const token = sourceToken?.chainId === FACTORY_ROUTE.bridgeToken.chainId ? sourceToken : fallback;
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [route, setRoute] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  const connect = async () => {
    try {
      const provider = window.ethereum;
      if (!provider?.request) throw new Error('No EVM wallet detected. Open in MetaMask/Coinbase or use the cross-chain route below.');
      await ensureRobinhoodWallet(provider);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0] || '';
      if (!isEvmAddress(address)) throw new Error('No EVM wallet connected.');
      setAccount(address);
      onWalletConnected?.({ address });
      setError('');
      return address;
    } catch (err) {
      setError(err?.message || 'Wallet connection failed.');
      return '';
    }
  };

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.request) return;
    provider.request({ method: 'eth_accounts' }).then((accounts) => {
      const address = accounts?.[0] || '';
      if (isEvmAddress(address)) {
        setAccount(address);
        onWalletConnected?.({ address });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setAmount('');
    setRoute(null);
    setState('idle');
    setError('');
  }, [token.id]);

  useEffect(() => {
    const numeric = Number(amount || 0);
    if (!numeric || numeric <= 0) {
      setRoute(null);
      setState('idle');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState('quoting');
      setError('');
      try {
        const found = await findKyberRobinhoodRoute({
          tokenIn: token.tokenAddress || ROUTING.robinhoodNativeToken,
          amountHuman: amount,
          origin: account,
        });
        if (cancelled) return;
        if (!found) {
          setRoute(null);
          setState('no-route');
          setError('No Robinhood route to $CUCK for this token/amount yet.');
          return;
        }
        setRoute(found);
        setState('ready');
        const fromUsd = found.amountInUsd || (token.usd > 0 && token.balance > 0 ? token.usd * (numeric / token.balance) : 0);
        onQuote?.({ fromUsd, toUsd: found.amountOutUsd || fromUsd });
      } catch (err) {
        if (cancelled) return;
        setRoute(null);
        setState('error');
        setError(err?.message || 'Route check failed.');
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [amount, token.id, account]);

  const execute = async () => {
    const wallet = account || await connect();
    if (!wallet || !route) return;
    setState('executing');
    setError('');
    try {
      const recipient = isEvmAddress(destination) ? destination : wallet;
      const before = await cuckBalance(recipient);
      const execution = await executeKyberRobinhoodSwap({
        route,
        tokenIn: token.tokenAddress || ROUTING.robinhoodNativeToken,
        sender: wallet,
        recipient,
      });
      const after = await cuckBalance(recipient);
      const beforeRaw = before?.raw ?? 0n;
      const afterRaw = after?.raw ?? 0n;
      const diff = afterRaw > beforeRaw ? afterRaw - beforeRaw : execution.quotedOut;
      const decimals = after?.decimals ?? before?.decimals ?? 18;
      const fromUsd = route.amountInUsd || 0;
      onFinished?.({
        fromUsd,
        toUsd: route.amountOutUsd || fromUsd,
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

  const maxAmount = Number(token.balance || 0);
  const setPct = (pct) => {
    if (!maxAmount) return;
    const value = maxAmount * pct;
    setAmount(String(Number(value.toPrecision(8))));
  };

  return (
    <section className="direct-swap">
      <div className="swap-heading">
        <strong>RECYCLE YOUR BAG</strong>
        <span>Already on Robinhood? The Factory finds the route and swaps directly into $CUCK.</span>
      </div>
      <div className="direct-route-badge">ROBINHOOD DIRECT · FINAL OUTPUT $CUCK</div>
      {!account ? <button type="button" className="direct-connect" onClick={connect}>CONNECT WALLET</button> : <div className="direct-wallet">✓ {shortAddress(account)}</div>}
      <div className="direct-grid">
        <div className="direct-token-card"><span>FROM</span><strong>{token.symbol}</strong><small>Robinhood Chain</small></div>
        <div className="direct-token-card output"><span>TO</span><strong>$CUCK</strong><small>Robinhood Chain</small></div>
      </div>
      <label className="direct-amount"><span>AMOUNT</span><div><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><b>{token.symbol}</b></div></label>
      {maxAmount > 0 ? <div className="direct-percent-row"><button type="button" onClick={() => setPct(.25)}>25%</button><button type="button" onClick={() => setPct(.5)}>50%</button><button type="button" onClick={() => setPct(.75)}>75%</button><button type="button" onClick={() => setPct(1)}>MAX</button></div> : null}
      <div className="direct-quote"><span>YOU RECEIVE</span><strong>{state === 'quoting' ? 'CHECKING…' : route ? `≈ ${formatUnits(route.amountOut, 18, 2)} $CUCK` : '— $CUCK'}</strong>{route ? <small>Best Robinhood route found automatically.</small> : null}</div>
      {error ? <div className="factory-finish-error">{error}</div> : null}
      <button type="button" className="direct-recycle" onClick={execute} disabled={!route || state === 'quoting' || state === 'executing' || state === 'done'}>{state === 'executing' ? 'RECYCLING…' : state === 'done' ? 'BAG RECYCLED ✓' : 'RECYCLE → $CUCK'}</button>
      <button type="button" className="direct-other" onClick={onUseCrossChain}>TOKEN ON ANOTHER CHAIN? →</button>
      <small className="direct-note">The router can use intermediate liquidity under the hood. You only choose the bag and receive $CUCK.</small>
    </section>
  );
}

function SwapWidget({ destination, sourceToken, sourceForm, onQuote, onCompleted, onStarted, onWalletConnected, onRoutes, onFormChanged, onSourceSelected }) {
  const lockedDestination = isEvmAddress(destination);
  const outputToken = FACTORY_ROUTE.bridgeToken.address;

  const widgetConfig = useMemo(() => {
    const config = {
      appearance: 'dark',
      variant: 'compact',
      fromChain: sourceToken?.chainId ?? sourceForm?.chainId ?? undefined,
      fromToken: sourceToken?.tokenAddress ?? sourceForm?.tokenAddress ?? undefined,
      fromAmount: sourceForm?.fromAmount || undefined,
      formUpdateKey: `${sourceToken ? `source:${sourceToken.id}` : `source:${sourceForm?.chainId || 'none'}:${sourceForm?.tokenAddress || 'none'}`}:factory-rh-eth`,
      toChain: FACTORY_ROUTE.bridgeToken.chainId,
      toToken: outputToken,
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
        to: { allow: [FACTORY_ROUTE.bridgeToken.chainId] },
      },
      tokens: {
        to: {
          allow: [{ chainId: FACTORY_ROUTE.bridgeToken.chainId, address: outputToken }],
        },
      },
      disabledUI: {
        toToken: true,
        ...(lockedDestination ? { toAddress: true } : {}),
      },
      hiddenUI: {
        appearance: true,
        language: true,
        reverseTokensButton: true,
        poweredBy: false,
      },
      showSingleRoute: true,
      routePriority: 'RECOMMENDED',
      slippage: 0.01,
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
        container: { border: '1px solid #765126', borderRadius: '3px', boxShadow: 'none', maxWidth: '100%' },
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
  }, [destination, lockedDestination, sourceToken, sourceForm?.chainId, sourceForm?.tokenAddress, sourceForm?.fromAmount, outputToken]);

  return (
    <section className="swap-section">
      <div className="swap-heading">
        <strong>RECYCLE YOUR BAG</strong>
        <span>Pick the token and amount. The Factory moves the value into Robinhood, then finishes the recycle into $CUCK.</span>
      </div>
      {!lockedDestination ? (
        <div className="guest-note">New here? Connect a wallet below. Existing Employees get their registered $CUCK destination automatically on cucks.money.</div>
      ) : null}
      <div className="factory-gateway-note"><b>FACTORY ROUTE</b><span>YOUR BAG → ROBINHOOD → $CUCK</span><small>Routing assets stay hidden. Your final output is $CUCK.</small></div>
      <EventBridge
        onQuote={onQuote}
        onCompleted={onCompleted}
        onStarted={onStarted}
        onWalletConnected={onWalletConnected}
        onRoutes={onRoutes}
        onFormChanged={onFormChanged}
        onSourceSelected={onSourceSelected}
      />
      <LiFiWidget integrator="cuck-factory-bag-recycler" config={widgetConfig} />
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
  const [state, setState] = useState('quoting');
  const [error, setError] = useState('');
  const recipient = gatewayResult?.destination || '';
  const amountHuman = gatewayResult?.gatewayAmount || '0';

  useEffect(() => {
    if (!gatewayResult || Number(amountHuman || 0) <= 0) return;
    let cancelled = false;
    setState('quoting');
    setError('');
    findKyberRobinhoodRoute({ tokenIn: ROUTING.robinhoodNativeToken, amountHuman, origin: recipient })
      .then((found) => {
        if (cancelled) return;
        if (!found) throw new Error('No Robinhood ETH → $CUCK route found.');
        setRoute(found);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setRoute(null);
        setError(err?.message || 'Factory quote unavailable');
        setState('error');
      });
    return () => { cancelled = true; };
  }, [gatewayResult, amountHuman, recipient]);

  if (!gatewayResult) return null;

  const execute = async () => {
    if (!route || !isEvmAddress(recipient)) {
      setError('Connect the EVM wallet that received the bridged ETH.');
      return;
    }
    setState('executing');
    setError('');
    try {
      const before = await cuckBalance(recipient);
      const execution = await executeKyberRobinhoodSwap({
        route,
        tokenIn: ROUTING.robinhoodNativeToken,
        sender: recipient,
        recipient,
      });
      const after = await cuckBalance(recipient);
      const beforeRaw = before?.raw ?? 0n;
      const afterRaw = after?.raw ?? 0n;
      const diff = afterRaw > beforeRaw ? afterRaw - beforeRaw : execution.quotedOut;
      const decimals = after?.decimals ?? before?.decimals ?? 18;
      onFinished({
        fromUsd: gatewayResult.fromUsd,
        toUsd: route.amountOutUsd || gatewayResult.toUsd || gatewayResult.fromUsd,
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
      <h3>FINISH THE RECYCLE → $CUCK</h3>
      <div className="factory-finish-flow"><div><span>ARRIVED</span><strong>{amountHuman} ETH</strong></div><b>→</b><div><span>EST. FINAL OUTPUT</span><strong>{route ? `${formatUnits(route.amountOut, 18, 2)} $CUCK` : '—'}</strong></div></div>
      <p>The Factory finds the best Robinhood liquidity route automatically. Intermediate assets stay hidden.</p>
      {state === 'quoting' ? <div className="factory-finish-status"><span className="pulse" /> CHECKING FACTORY LIQUIDITY…</div> : null}
      {error ? <div className="factory-finish-error">{error}</div> : null}
      <button type="button" className="smart-primary" onClick={execute} disabled={!route || state === 'quoting' || state === 'executing' || state === 'done'}>{state === 'executing' ? 'CONFIRMING → $CUCK…' : state === 'done' ? 'BAG RECYCLED ✓' : 'FINISH → $CUCK'}</button>
    </section>
  );
}

function RouteNotice({ routeState, sourceForm }) {
  if (Number(sourceForm?.fromAmount || 0) <= 0 || routeState !== 'no-route') return null;
  return (
    <section className="smart-router warning">
      <span className="smart-kicker">THIS BAG CAN'T REACH THE FACTORY GATEWAY YET</span>
      <strong>TRY ANOTHER AMOUNT OR TOKEN.</strong>
      <p>Nothing has been submitted. The app only continues when LI.FI can move the value to USDG on Robinhood.</p>
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

  const handleWalletConnected = (payload) => {
    const address = payload?.address || '';
    if (!address) return;
    setWallets((current) => ({
      ...current,
      ...(isEvmAddress(address) ? { evmAddress: address } : {}),
      ...(looksLikeSolanaAddress(address) ? { solanaAddress: address } : {}),
    }));
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
    setCrossChainMode(Number(holding.chainId) !== FACTORY_ROUTE.bridgeToken.chainId);
    setSourceForm({ chainId: holding.chainId, tokenAddress: holding.tokenAddress, fromAmount: '' });
    window.setTimeout(() => document.getElementById('swap-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
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
    if (payload.fieldName === 'fromAmount') {
      setSourceForm((current) => ({ ...current, fromAmount: String(payload.newValue ?? '') }));
      setRouteState('idle');
      setGatewayResult(null);
      setResult(null);
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
    const rawGateway = String(route?.toAmount || '0');
    setQuote({ fromUsd, toUsd });
    setGatewayResult({
      fromUsd,
      toUsd,
      amountInRaw: rawGateway,
      gatewayAmount: formatUnits(rawGateway, route?.toToken?.decimals ?? FACTORY_ROUTE.bridgeToken.decimals, 8),
      fromSymbol,
      fromAmount,
      destination: routeDestination,
    });
    setStatus('gateway-done');
    window.setTimeout(() => document.getElementById('factory-finish')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
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

        <WalletHoldings
          holdings={holdings}
          loading={holdingsLoading}
          error={holdingsError}
          connected={isEvmAddress(wallets.evmAddress) || looksLikeSolanaAddress(wallets.solanaAddress)}
          onRecycle={handleHoldingSelected}
          selected={selectedHolding}
        />

        <div id="swap-widget">
          {!crossChainMode && (!selectedHolding || Number(selectedHolding.chainId) === FACTORY_ROUTE.bridgeToken.chainId) ? (
            <RobinhoodDirectSwap
              destination={destination}
              sourceToken={selectedHolding}
              onQuote={setQuote}
              onFinished={handleFactoryFinished}
              onWalletConnected={handleWalletConnected}
              onUseCrossChain={() => {
                setCrossChainMode(true);
                setSelectedHolding(null);
                setSourceForm({ chainId: null, tokenAddress: '', fromAmount: '' });
              }}
            />
          ) : (
            <SwapWidget
              destination={destination}
              sourceToken={selectedHolding}
              sourceForm={sourceForm}
              onQuote={handleQuote}
              onStarted={handleStarted}
              onCompleted={handleCompleted}
              onWalletConnected={handleWalletConnected}
              onRoutes={handleRoutes}
              onFormChanged={handleFormChanged}
              onSourceSelected={handleSourceSelected}
            />
          )}
        </div>

        {crossChainMode ? <RouteNotice routeState={routeState} sourceForm={sourceForm} /> : null}

        {status === 'swapping' ? (
          <div className="status-line"><span className="pulse" /> Bridge in progress · moving value into Robinhood.</div>
        ) : null}

        {gatewayResult && !result ? (
          <FactoryFinish gatewayResult={gatewayResult} onFinished={handleFactoryFinished} />
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
        <span>Robinhood bags: direct → $CUCK · Other chains: bridge to Robinhood → $CUCK</span>
      </footer>
      <div className="prototype-note">Prototype economics: ${CUCKDROP_USD_PER_CP.toFixed(3)} estimated Cuckdrop value / CP. Final values come from the live Factory backend.</div>
    </div>
  );
}


createRoot(document.getElementById('root')).render(<App />);
