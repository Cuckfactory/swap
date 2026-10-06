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
  REFERRAL,
} from './config.js';
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

function EventBridge({ onQuote, onCompleted, onStarted }) {
  const widgetEvents = useWidgetEvents();

  useEffect(() => {
    const available = (routes) => {
      const route = Array.isArray(routes) ? routes[0] : null;
      if (route) onQuote(route);
    };
    const selected = (payload) => {
      if (payload?.route) onQuote(payload.route);
    };
    const started = (route) => onStarted(route);
    const completed = (route) => onCompleted(route);

    widgetEvents.on(WidgetEvent.AvailableRoutes, available);
    widgetEvents.on(WidgetEvent.RouteSelected, selected);
    widgetEvents.on(WidgetEvent.RouteExecutionStarted, started);
    widgetEvents.on(WidgetEvent.RouteExecutionCompleted, completed);

    return () => widgetEvents.removeAllListeners();
  }, [widgetEvents, onQuote, onCompleted, onStarted]);

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

function EmployeeLine({ destination, employeeId }) {
  if (!isEvmAddress(destination)) return null;
  return (
    <div className="employee-line">
      <span>✓ {employeeId || 'EMPLOYEE'} RECOGNISED</span>
      <b>$CUCK destination {shortAddress(destination)}</b>
    </div>
  );
}

function SwapWidget({ destination, onQuote, onCompleted, onStarted }) {
  const lockedDestination = isEvmAddress(destination);

  const widgetConfig = useMemo(() => {
    const config = {
      appearance: 'dark',
      variant: 'compact',
      toChain: CUCK.chainId,
      toToken: CUCK.address,
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
        to: {
          allow: [{ chainId: CUCK.chainId, address: CUCK.address }],
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
        shape: {
          borderRadius: 3,
          borderRadiusSecondary: 3,
          borderRadiusTertiary: 3,
        },
        typography: { fontFamily: 'Arial, Helvetica, sans-serif' },
        container: {
          border: '1px solid #765126',
          borderRadius: '3px',
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
  }, [destination, lockedDestination]);

  return (
    <section className="swap-section">
      <div className="swap-heading">
        <strong>RECYCLE YOUR BAG</strong>
        <span>Choose what you want to swap and how much. $CUCK is already locked as the output.</span>
      </div>
      {!lockedDestination ? (
        <div className="guest-note">New here? Just connect a wallet below. Existing Employees get their registered $CUCK destination automatically on cucks.money.</div>
      ) : null}
      <EventBridge onQuote={onQuote} onCompleted={onCompleted} onStarted={onStarted} />
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

  const handleQuote = (route) => {
    const fromUsd = getRouteUsd(route, 'from');
    const toUsd = getRouteUsd(route, 'to');
    if (fromUsd > 0 || toUsd > 0) setQuote({ fromUsd, toUsd });
  };

  const handleStarted = (route) => {
    setStatus('swapping');
    handleQuote(route);
  };

  const handleCompleted = (route) => {
    const fromUsd = getRouteUsd(route, 'from');
    const toUsd = getRouteUsd(route, 'to');
    const cuckAmount = formatUnits(route?.toAmount, route?.toToken?.decimals ?? 18, 4);
    const fromSymbol = route?.fromToken?.symbol || 'TOKEN';
    const fromAmount = formatUnits(route?.fromAmount, route?.fromToken?.decimals ?? 18, 6);
    const routeDestination = typeof route?.toAddress === 'string' ? route.toAddress : (route?.toAddress?.address || '');
    setQuote({ fromUsd, toUsd });
    setResult({ fromUsd, toUsd, cuckAmount, fromSymbol, fromAmount, destination: routeDestination });
    setStatus('done');
    window.setTimeout(() => document.getElementById('success')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  const simulate = () => {
    setQuote({ fromUsd: 8, toUsd: 7.88 });
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

        <SwapWidget
          destination={destination}
          onQuote={handleQuote}
          onStarted={handleStarted}
          onCompleted={handleCompleted}
        />

        {status === 'swapping' ? (
          <div className="status-line"><span className="pulse" /> Swap in progress. The Factory is watching the route.</div>
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
        <span>Swap routing by LI.FI · $CUCK on Robinhood Chain</span>
      </footer>
      <div className="prototype-note">Prototype economics: ${CUCKDROP_USD_PER_CP.toFixed(3)} estimated Cuckdrop value / CP. Final values come from the live Factory backend.</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
