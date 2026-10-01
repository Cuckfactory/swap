(() => {
  'use strict';

  const CONFIG = {
    cuckContract: '0x7648f37c2314466726a28f7a5edbdb8dc7b3e23f',
    robinhoodChainId: 4663,
    blockscoutBase: 'https://robinhoodchain.blockscout.com/api/v2',
    swapBaseUrl: 'https://jumper.exchange/',
    demoUsdPerCuckPower: 0.015,
    pollMs: 9000,
    maxPolls: 40,
    tiers: [
      { usd: 1, cp: 500 },
      { usd: 5, cp: 1000 },
      { usd: 25, cp: 2500 },
      { usd: 50, cp: 3500 },
      { usd: 100, cp: 5000 },
      { usd: 250, cp: 7500 },
      { usd: 500, cp: 10000 },
    ],
  };

  const DEMO_EMPLOYEE = {
    id: 'CF-000072',
    wallet: '0x52310000000000000000000000000000005A6EED',
  };

  const state = {
    employee: null,
    baselineBalance: null,
    swapStartedAt: null,
    pollTimer: null,
    polls: 0,
    detectedAmount: 0,
  };

  const $ = (id) => document.getElementById(id);
  const short = (a) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—';
  const fmt = (n, digits = 2) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
  const money = (n) => `$${Number(n || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  function tierForUsd(usd) {
    let out = { usd: 0, cp: 0 };
    for (const tier of CONFIG.tiers) if (usd >= tier.usd) out = tier;
    return out;
  }

  function updatePreview(usd) {
    const tier = tierForUsd(usd);
    $('previewUsd').textContent = `$${usd}${usd === 500 ? '+' : ''}`;
    $('previewCuck').textContent = `~$${usd} IN $CUCK`;
    $('previewCp').textContent = `+${fmt(tier.cp,0)} CUCK POWER`;
    $('previewDrop').textContent = tier.cp ? `≈ ${money(tier.cp * CONFIG.demoUsdPerCuckPower)} extra Cuckdrop value*` : 'Bonus starts at $1';
    document.querySelectorAll('[data-usd]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.usd) === usd));
  }

  document.querySelectorAll('[data-usd]').forEach(btn => btn.addEventListener('click', () => updatePreview(Number(btn.dataset.usd))));

  function loadEmployee() {
    // Test build: use a known Employee state only.
    // Production: hydrate this from the active Employee session / Employee Record.
    state.employee = DEMO_EMPLOYEE;
    $('employeeId').textContent = state.employee.id;
    $('walletDisplay').textContent = state.employee.wallet;
    $('destinationShort').textContent = short(state.employee.wallet);
  }

  function buildSwapUrl() {
    const u = new URL(CONFIG.swapBaseUrl);
    u.searchParams.set('toChain', String(CONFIG.robinhoodChainId));
    u.searchParams.set('toToken', CONFIG.cuckContract);
    u.searchParams.set('toAddress', state.employee.wallet);
    return u.toString();
  }

  async function fetchJson(url) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return r.json();
  }

  async function getCuckBalance(wallet) {
    const data = await fetchJson(`${CONFIG.blockscoutBase}/addresses/${wallet}/token-balances`);
    const items = Array.isArray(data) ? data : (data?.items || []);
    const row = items.find(x => String(x?.token?.address_hash || x?.token?.address || '').toLowerCase() === CONFIG.cuckContract.toLowerCase());
    if (!row) return 0;
    const raw = Number(row.value ?? row.balance ?? 0);
    const decimals = Number(row?.token?.decimals ?? 18);
    return raw / Math.pow(10, decimals);
  }

  async function getCuckUsdPrice() {
    try {
      const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${CONFIG.cuckContract}`);
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      const best = pairs.filter(x => x?.priceUsd).sort((a,b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
      const p = Number(best?.priceUsd);
      return Number.isFinite(p) && p > 0 ? p : null;
    } catch { return null; }
  }

  function setMessage(text, ok = false) {
    $('checkMessage').textContent = text;
    $('checkMessage').classList.toggle('success', ok);
  }

  async function startRecycle() {
    if (!state.employee) return;
    const popup = window.open('about:blank', '_blank');
    setMessage('Preparing your receiving wallet…');
    try {
      state.baselineBalance = await getCuckBalance(state.employee.wallet);
    } catch {
      // Keep the UX moving in prototype; production backend should make this reliable.
      state.baselineBalance = 0;
    }
    state.swapStartedAt = Date.now();
    state.polls = 0;
    $('watchCard').hidden = false;
    $('successCard').hidden = true;
    const url = buildSwapUrl();
    if (popup) popup.location = url; else window.open(url, '_blank', 'noopener,noreferrer');
    setMessage('Jumper opened. We’ll watch your Employee wallet for incoming $CUCK.', true);
    $('watchCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    beginPolling();
  }

  function beginPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      state.polls += 1;
      const found = await checkWallet(false);
      if (found || state.polls >= CONFIG.maxPolls) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }, CONFIG.pollMs);
  }

  async function checkWallet(manual = true) {
    if (!state.employee || state.baselineBalance === null) return false;
    if (manual) setMessage('Checking your Employee wallet…');
    try {
      const current = await getCuckBalance(state.employee.wallet);
      const delta = current - state.baselineBalance;
      if (delta > 0.000001) {
        state.detectedAmount = delta;
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = null;
        await showSuccess(delta);
        return true;
      }
      if (manual) setMessage('No new $CUCK yet. Cross-chain swaps can take a little time — wait a minute and try again.');
    } catch (e) {
      if (manual) setMessage('Could not check the wallet right now. Try again in a moment.');
    }
    return false;
  }

  async function showSuccess(amount) {
    const price = await getCuckUsdPrice();
    const usd = price ? amount * price : null;
    const tier = usd === null ? { cp: 0 } : tierForUsd(usd);
    $('receivedCuck').textContent = `${fmt(amount,2)} $CUCK`;
    $('receivedUsd').textContent = usd === null ? 'LIVE PRICE PENDING' : money(usd);
    $('bonusCp').textContent = tier.cp ? `+${fmt(tier.cp,0)} CP` : 'CALCULATING';
    $('bonusDrop').textContent = tier.cp ? `≈ ${money(tier.cp * CONFIG.demoUsdPerCuckPower)}` : '—';
    $('requiredHold').textContent = `${fmt(amount,2)} $CUCK`;
    $('successCard').hidden = false;
    setMessage(`Detected +${fmt(amount,2)} $CUCK in your Employee wallet.`, true);
    $('successCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function extractHash(raw) {
    const m = String(raw || '').match(/0x[a-fA-F0-9]{64}/);
    return m ? m[0] : '';
  }

  async function resolveLifiSourceTx(hash) {
    // Fallback only. LI.FI's status endpoint can resolve a sending tx into the receiving tx.
    const status = await fetchJson(`https://li.quest/v1/status?txHash=${encodeURIComponent(hash)}`);
    return status;
  }

  $('startBtn').addEventListener('click', startRecycle);
  $('reopenBtn').addEventListener('click', () => state.employee && window.open(buildSwapUrl(), '_blank', 'noopener,noreferrer'));
  $('checkBtn').addEventListener('click', () => checkWallet(true));

  $('fallbackBtn').addEventListener('click', async () => {
    const hash = extractHash($('fallbackTx').value);
    if (!hash) {
      $('fallbackMessage').textContent = 'Paste the transaction link or hash Jumper gives you.';
      return;
    }
    $('fallbackMessage').textContent = 'Following the LI.FI route…';
    $('fallbackMessage').classList.remove('success');
    try {
      const status = await resolveLifiSourceTx(hash);
      const receivingHash = status?.receiving?.txHash || status?.receiving?.txLink || '';
      if (String(status?.status || '').toUpperCase() === 'PENDING') {
        $('fallbackMessage').textContent = 'Jumper still shows this route as pending. Try again shortly.';
        return;
      }
      if (receivingHash) {
        $('fallbackMessage').textContent = 'Destination transaction found. Now checking your Employee wallet…';
        await checkWallet(true);
      } else {
        $('fallbackMessage').textContent = 'Route found, but the destination transaction is not available yet. Try again shortly.';
      }
    } catch {
      $('fallbackMessage').textContent = 'Could not follow that route yet. Wait a moment and retry.';
    }
  });

  // Prototype helper: press Alt+D while focused on the page to simulate a successful $100 recycle.
  document.addEventListener('keydown', async (e) => {
    if (e.altKey && e.key.toLowerCase() === 'd') {
      const price = await getCuckUsdPrice() || 0.0002;
      state.baselineBalance = 0;
      $('watchCard').hidden = false;
      await showSuccess(100 / price);
    }
  });

  loadEmployee();
  updatePreview(100);
})();
