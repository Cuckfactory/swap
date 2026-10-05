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
import { bonusForUsd, CUCK, CUCKDROP_USD_PER_CP, dropValueForCp } from './config.js';
import './styles.css';

function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function compactNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function shortAddress(address) {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
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

function ValuePromise({ quote }) {
  const exampleUsd = 5;
  const sourceUsd = quote?.fromUsd > 0 ? quote.fromUsd : exampleUsd;
  const receivedUsd = quote?.toUsd > 0 ? quote.toUsd : exampleUsd;
  const cp = bonusForUsd(sourceUsd);
  const dropUsd = dropValueForCp(cp);
  const live = quote?.fromUsd > 0;

  return (
    <section className={`promise ${live ? 'is-live' : ''}`} aria-live="polite">
      <div className="promise-kicker">{live ? 'YOUR SWAP' : 'SIMPLE EXAMPLE'}</div>
      <div className="promise-grid">
        <div className="promise-part">
          <span>YOU RECYCLE</span>
          <strong>{money(sourceUsd)}</strong>
        </div>
        <div className="promise-arrow">→</div>
        <div className="promise-part">
          <span>YOU RECEIVE</span>
          <strong>≈ {money(receivedUsd)}</strong>
          <small>IN $CUCK</small>
        </div>
        <div className="promise-plus">+</div>
        <div className="promise-part bonus-part">
          <span>EXTRA CUCKDROP VALUE</span>
          <strong>≈ {money(dropUsd)}</strong>
          <small>+{cp.toLocaleString('en-US')} Cuck Power · current drop value</small>
        </div>
      </div>
      <p className="promise-rule">Your leftover becomes $CUCK. The Cuckdrop bonus comes on top.</p>
    </section>
  );
}

function WalletGate({ initialWallet, onReady }) {
  const [wallet, setWallet] = useState(initialWallet || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialWallet && isEvmAddress(initialWallet)) onReady(initialWallet);
  }, [initialWallet, onReady]);

  if (initialWallet && isEvmAddress(initialWallet)) {
    return (
      <div className="employee-chip">
        <span>✓ EMPLOYEE WALLET READY</span>
        <strong>{shortAddress(initialWallet)}</strong>
      </div>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    if (!isEvmAddress(wallet)) {
      setError('Paste a valid Robinhood/EVM receiving address.');
      return;
    }
    setError('');
    onReady(wallet.trim());
  };

  return (
    <form className="wallet-gate" onSubmit={submit}>
      <div>
        <span className="step-dot">1</span>
        <div>
          <strong>WHERE SHOULD YOUR $CUCK LAND?</strong>
          <small>Existing Employees skip this automatically.</small>
        </div>
      </div>
      <div className="wallet-row">
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x… receiving wallet"
          autoComplete="off"
          spellCheck="false"
        />
        <button type="submit">CONTINUE</button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}

function SwapWidget({ destination, onQuote, onCompleted, onStarted }) {
  const widgetConfig = useMemo(() => ({
    appearance: 'dark',
    variant: 'compact',
    fromChain: undefined,
    fromToken: undefined,
    fromAmount: undefined,
    toChain: CUCK.chainId,
    toToken: CUCK.address,
    toAddress: {
      name: 'Cuck Factory Employee Wallet',
      address: destination,
      chainType: ChainType.EVM,
    },
    providers: [EthereumProvider(), SolanaProvider()],
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
      toAddress: true,
    },
    hiddenUI: {
      appearance: true,
      language: true,
      reverseTokensButton: true,
      toAddress: false,
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
            background: { default: '#0a0503', paper: '#170b07' },
            text: { primary: '#fff0d1', secondary: '#b59c75' },
          },
        },
      },
      shape: {
        borderRadius: 3,
        borderRadiusSecondary: 3,
        borderRadiusTertiary: 3,
      },
      typography: {
        fontFamily: 'Arial, Helvetica, sans-serif',
      },
      container: {
        border: '1px solid #7b562c',
        borderRadius: '4px',
        boxShadow: 'none',
        maxWidth: '100%',
      },
    },
  }), [destination]);

  return (
    <div className="widget-wrap">
      <div className="widget-head">
        <span className="step-dot">2</span>
        <div>
          <strong>PICK THE TOKEN. PICK THE AMOUNT.</strong>
          <small>$CUCK + destination are already locked in.</small>
        </div>
      </div>
      <EventBridge onQuote={onQuote} onCompleted={onCompleted} onStarted={onStarted} />
      <LiFiWidget integrator="cuck-factory-bag-recycler" config={widgetConfig} />
    </div>
  );
}

function Success({ result, destination }) {
  const cp = bonusForUsd(result.fromUsd);
  const dropUsd = dropValueForCp(cp);
  const cuckAmount = result.cuckAmount || '—';

  return (
    <section className="success" id="success">
      <div className="success-stamp">BAG<br />RECYCLED</div>
      <div>
        <span className="micro">MANAGEMENT HAS ACCEPTED YOUR LOSSES</span>
        <h2>YOU PUT IT BACK TO WORK.</h2>
        <div className="success-numbers">
          <div>
            <span>$CUCK RECEIVED</span>
            <strong>{result.toUsd > 0 ? money(result.toUsd) : cuckAmount}</strong>
            <small>{cuckAmount !== '—' ? `${cuckAmount} $CUCK` : 'route completed'}</small>
          </div>
          <div className="success-bonus">
            <span>EXTRA CUCKDROP VALUE</span>
            <strong>≈ {money(dropUsd)}</strong>
            <small>+{cp.toLocaleString('en-US')} Cuck Power</small>
          </div>
        </div>
        <div className="one-rule">
          <strong>ONE RULE</strong>
          <p>Keep the {cuckAmount !== '—' ? `${cuckAmount} ` : ''}$CUCK from this recycle in <b>{shortAddress(destination)}</b> until the Cuckdrop. Drop below it and the Recycling Cuck Power disappears.</p>
        </div>
      </div>
    </section>
  );
}

function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const prefilled = params.get('wallet') || window.__CUCK_EMPLOYEE_WALLET__ || '';
  const [destination, setDestination] = useState(isEvmAddress(prefilled) ? prefilled : '');
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
    setQuote({ fromUsd, toUsd });
    setResult({ fromUsd, toUsd, cuckAmount });
    setStatus('done');
    window.setTimeout(() => document.getElementById('success')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  return (
    <div className="site-shell">
      <header className="brand-bar">
        <a href="https://cucks.money/" className="brand">THE CUCK FACTORY</a>
        <span>DEPARTMENT OF ASSET REASSIGNMENT</span>
      </header>

      <main>
        <section className="hero">
          <span className="micro">FACTORY SERVICE № 05 · BAG RECYCLING</span>
          <h1>YOUR BAG IS FUCKED.<br /><em>MAKE WHAT'S LEFT PAY.</em></h1>
          <p className="hero-copy">Any token. Any supported chain. Any amount. Turn what is left into <b>$CUCK</b> and get <b>extra Cuckdrop value on top.</b></p>
        </section>

        <ValuePromise quote={quote} />

        <section className="flow-card">
          {!destination ? (
            <WalletGate initialWallet={prefilled} onReady={setDestination} />
          ) : (
            <div className="employee-chip">
              <span>✓ $CUCK DESTINATION READY</span>
              <strong>{shortAddress(destination)}</strong>
            </div>
          )}

          {destination ? (
            <SwapWidget
              destination={destination}
              onQuote={handleQuote}
              onStarted={handleStarted}
              onCompleted={handleCompleted}
            />
          ) : (
            <div className="locked-placeholder">Enter the receiving wallet once. Then the swap is one screen.</div>
          )}
        </section>

        {status === 'swapping' ? (
          <div className="status-line"><span className="pulse" /> Factory is watching the route. Finish the swap in the widget.</div>
        ) : null}

        {result ? <Success result={result} destination={destination} /> : null}

        <section className="rule-strip">
          <strong>THE DEAL</strong>
          <span>Your leftover becomes $CUCK.</span>
          <b>Extra Cuckdrop comes on top.</b>
          <span>Hold the recycled $CUCK until the Cuckdrop to keep the bonus.</span>
        </section>
      </main>

      <footer>
        <span>THE CUCK FACTORY · ASSET REASSIGNMENT</span>
        <span>Powered by LI.FI routing · Robinhood Chain destination</span>
      </footer>
      <div className="prototype-note">Prototype Cuckdrop conversion: ${CUCKDROP_USD_PER_CP.toFixed(3)} / CP · replace with live Factory rate.</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
