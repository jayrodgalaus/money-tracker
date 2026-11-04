import { ACCOUNT_DEFS, getSnapshot, parsePesos, recordMovement, saveStartingBalances, todayLocal, validDate } from './db.js?v=3';

const view = document.getElementById('view');
const message = document.getElementById('message');
const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
const longDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' });
let snapshot = { accounts: [], transactions: [] };
let busy = false;
let noticeTimeout;

function pesos(cents) { return currency.format(cents / 100); }
function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (character) => replacements[character]);
}
function displayDate(date) {
  if (!validDate(date)) return 'Unknown date';
  return longDate.format(new Date(date + 'T12:00:00'));
}
function getAccount(id) {
  return snapshot.accounts.find((account) => account.id === id) ||
    ACCOUNT_DEFS.find((account) => account.id === id);
}
function bankAccounts() {
  return snapshot.accounts.filter((account) => account.kind === 'bank')
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
function allAccounts() {
  return [...bankAccounts(), ...snapshot.accounts.filter((account) => account.kind === 'cash')];
}
function sortedTransactions(transactions) {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date) ||
    b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}
function monthlyTransactions(kind) {
  const month = todayLocal().slice(0, 7);
  return snapshot.transactions.filter((entry) => entry.kind === kind && entry.date.startsWith(month));
}
function monthlyTotal(kind) {
  return monthlyTransactions(kind).reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
}
function totalBalance() {
  return snapshot.accounts.reduce((sum, account) => sum + account.balanceCents, 0);
}
function pageHeader(eyebrow, title, description = '') {
  return '<div class="page-heading"><p class="eyebrow">' + escapeHtml(eyebrow) + '</p>' +
    '<h1 class="page-title">' + escapeHtml(title) + '</h1>' +
    (description ? '<p class="page-subtitle">' + escapeHtml(description) + '</p>' : '') + '</div>';
}
function backLink(target, text = 'Back') {
  return '<a class="back-link" href="#' + target + '"><span aria-hidden="true">‹</span> ' + escapeHtml(text) + '</a>';
}
function sectionHeading(title, small = '') {
  return '<div class="section-heading"><h2>' + escapeHtml(title) + '</h2>' +
    (small ? '<small>' + escapeHtml(small) + '</small>' : '') + '</div>';
}
function emptyState(title, text, href = '', linkText = '') {
  return '<div class="empty-state"><strong>' + escapeHtml(title) + '</strong>' + escapeHtml(text) +
    (href ? '<div class="mt-3"><a href="#' + href + '">' + escapeHtml(linkText) + ' ›</a></div>' : '') + '</div>';
}
function accountRow(account) {
  return '<a class="account-row" href="#/account/' + encodeURIComponent(account.id) + '">' +
    '<span class="account-avatar ' + account.id.replace('on-hand', 'cash') + '" aria-hidden="true">' + escapeHtml(account.symbol) + '</span>' +
    '<span class="account-description"><span class="account-name">' + escapeHtml(account.name) + '</span>' +
    '<span class="account-type">' + (account.kind === 'bank' ? 'Bank / e-wallet' : 'Physical cash') + '</span></span>' +
    '<span class="account-value">' + pesos(account.balanceCents) + '</span><span class="chevron" aria-hidden="true">›</span></a>';
}
function transactionRow(entry) {
  const adjustment = entry.kind === 'adjustment';
  const out = entry.amountCents < 0;
  const name = getAccount(entry.sourceId)?.name || 'Unknown source';
  const label = adjustment ? (entry.note || 'Balance adjustment') : (out ? 'Cash out' : 'Cash in');
  const amountClass = adjustment ? 'neutral' : (out ? 'negative' : 'positive');
  const iconClass = adjustment ? 'adjustment' : (out ? 'out' : '');
  const icon = adjustment ? '≈' : (out ? '−' : '+');
  return '<div class="transaction-row">' +
    '<span class="transaction-icon ' + iconClass + '" aria-hidden="true">' + icon + '</span>' +
    '<div class="transaction-main"><strong>' + escapeHtml(name) + '</strong>' +
    '<small>' + escapeHtml(label) + ' · ' + displayDate(entry.date) + '</small></div>' +
    '<span class="transaction-amount ' + amountClass + '">' +
    (entry.amountCents < 0 ? '−' : '+') + pesos(Math.abs(entry.amountCents)) + '</span></div>';
}
function transactionList(transactions, context) {
  if (!transactions.length) {
    return emptyState('No activity yet', 'Your ' + context + ' will appear here as you record them.');
  }
  return '<div class="transaction-list">' + sortedTransactions(transactions).map(transactionRow).join('') + '</div>';
}
function dashboard() {
  const date = new Date();
  const month = monthLabel.format(date);
  const noSetup = snapshot.accounts.every((account) => !account.initialized);
  return pageHeader('Your overview', 'Good to see you!', 'Your balances at a glance · ' + month) +
    '<a class="hero-card" href="#/ledger" aria-label="View full transaction ledger">' +
    '<div class="hero-label">Total Amount</div><strong class="hero-value">' + pesos(totalBalance()) + '</strong>' +
    '<div class="hero-foot"><span>Across all accounts and on-hand cash</span><span>View ledger ↗</span></div></a>' +
    sectionHeading('Monthly transactions', month) +
    '<div class="summary-grid">' +
    '<a class="summary-card" href="#/cash-in"><span class="summary-symbol" aria-hidden="true">↓</span>' +
    '<div class="summary-label">Cash in</div><div class="summary-value">' + pesos(monthlyTotal('cash-in')) + '</div>' +
    '<span class="summary-foot">See cash-ins ›</span></a>' +
    '<a class="summary-card out" href="#/cash-out"><span class="summary-symbol" aria-hidden="true">↑</span>' +
    '<div class="summary-label">Cash out</div><div class="summary-value">' + pesos(monthlyTotal('cash-out')) + '</div>' +
    '<span class="summary-foot">See cash-outs ›</span></a></div>' +
    (noSetup ? '<div class="info-panel">Start by setting your bank and on-hand balances in <a href="#/settings/initialize">Settings → Initialize</a>.</div>' : '') +
    sectionHeading('Banks', 'Tap an account to view details') +
    '<div class="account-list">' + bankAccounts().map(accountRow).join('') + '</div>' +
    sectionHeading('On-hand', 'Physical cash') +
    '<div class="account-list">' + snapshot.accounts.filter((account) => account.kind === 'cash').map(accountRow).join('') + '</div>';
}
function ledgerPage() {
  return backLink('/dashboard', 'Dashboard') +
    pageHeader('Activity', 'Transaction ledger', 'Every transaction and balance adjustment, newest date first.') +
    '<div class="detail-card"><div class="label">Total Amount</div><div class="amount">' + pesos(totalBalance()) + '</div></div>' +
    sectionHeading('All transactions', snapshot.transactions.length + ' entries') +
    transactionList(snapshot.transactions, 'ledger entries');
}
function movementPage(kind) {
  const isIn = kind === 'cash-in';
  const title = isIn ? 'Cash in' : 'Cash out';
  const transactions = snapshot.transactions.filter((entry) => entry.kind === kind);
  return backLink('/dashboard', 'Dashboard') +
    pageHeader('Money movement', title, 'View everything you have recorded.') +
    '<div class="detail-card"><div class="label">Total ' + title.toLowerCase() + ' · ' + monthLabel.format(new Date()) +
    '</div><div class="amount">' + pesos(monthlyTotal(kind)) + '</div></div>' +
    '<a class="btn-primary-custom w-100" href="#/record/' + kind + '">+ Record ' + title.toLowerCase() + '</a>' +
    sectionHeading('Recorded ' + title.toLowerCase() + 's', transactions.length + ' entries') +
    transactionList(transactions, title.toLowerCase() + ' records');
}
function accountPage(id) {
  const account = getAccount(id);
  if (!account) return notFound();
  const transactions = snapshot.transactions.filter((entry) => entry.sourceId === id);
  const suffix = '?source=' + encodeURIComponent(id);
  return backLink('/dashboard', 'Dashboard') +
    pageHeader(account.kind === 'bank' ? 'Bank / e-wallet' : 'Physical cash', account.name, 'Your current available balance and history.') +
    '<div class="detail-card"><div class="label">Available balance</div><div class="amount">' + pesos(account.balanceCents) + '</div></div>' +
    '<div class="action-row"><a class="btn-primary-custom" href="#/record/cash-in' + suffix + '">+ Cash in</a>' +
    '<a class="btn-secondary-custom" href="#/record/cash-out' + suffix + '">− Cash out</a></div>' +
    sectionHeading('Account activity', transactions.length + ' entries') +
    transactionList(transactions, account.name + ' transactions');
}
function movementForm(kind, params) {
  const isOut = kind === 'cash-out';
  const title = isOut ? 'Cash out' : 'Cash in';
  const requested = params.get('source');
  const selected = allAccounts().some((account) => account.id === requested) ? requested : allAccounts()[0]?.id;
  const chosen = getAccount(selected);
  const options = allAccounts().map((account) =>
    '<option value="' + account.id + '"' + (account.id === selected ? ' selected' : '') + '>' + escapeHtml(account.name) + '</option>').join('');
  return backLink('/' + kind, 'All ' + title.toLowerCase() + 's') +
    pageHeader('New transaction', 'Record ' + title.toLowerCase(), 'Choose where the money ' + (isOut ? 'will come from.' : 'will go.') ) +
    '<form id="movement-form" data-kind="' + kind + '" class="form-panel" novalidate>' +
    '<div class="field"><label for="source">Source</label><select id="source" name="source" class="form-select" required>' + options + '</select>' +
    '<p class="field-help" id="available-balance">Available: ' + pesos(chosen?.balanceCents || 0) + '</p></div>' +
    '<div class="field"><label for="amount">Amount (₱)</label><input class="form-control" type="number" id="amount" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></div>' +
    '<div class="field"><label for="date">Date</label><input class="form-control" type="date" id="date" name="date" value="' + todayLocal() + '" required></div>' +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button class="btn-primary-custom" type="submit">Save ' + title.toLowerCase() + '</button>' +
    '</form>' + (isOut ? '<div class="info-panel">Cash out cannot exceed the selected source\'s available balance.</div>' : '');
}
function settingsPage() {
  return pageHeader('Preferences', 'Settings', 'Manage where your money starts.') +
    '<div class="settings-list"><a class="settings-link" href="#/settings/initialize">' +
    '<span class="account-avatar cash" aria-hidden="true">₱</span><span class="account-description"><strong>Initialize balances' +
    '<small>Set or correct bank and on-hand amounts</small></strong></span><span class="chevron" aria-hidden="true">›</span></a></div>' +
    '<div class="info-panel">All amounts and transactions are saved only in this browser with IndexedDB. Clearing browser site data can erase them.</div>';
}
function initializePage() {
  return backLink('/settings', 'Settings') +
    pageHeader('Initialize', 'Set starting balances', 'Choose which balances to initialize or update.') +
    '<div class="settings-list">' +
    '<a class="settings-link" href="#/settings/initialize/banks"><span class="account-avatar" aria-hidden="true">▦</span>' +
    '<span class="account-description"><strong>Banks<small>BDO, BPI, GCash, GoTyme, MariBank, OwnBank, RCBC, Wise</small></strong></span><span class="chevron" aria-hidden="true">›</span></a>' +
    '<a class="settings-link" href="#/settings/initialize/on-hand"><span class="account-avatar cash" aria-hidden="true">₱</span>' +
    '<span class="account-description"><strong>On-hand<small>Initialize physical cash</small></strong></span><span class="chevron" aria-hidden="true">›</span></a></div>' +
    '<div class="info-panel">Saving a different balance creates a dated ledger adjustment. Adjustments do not change monthly cash-in or cash-out totals.</div>';
}
function balanceInput(account) {
  return '<div class="bank-field-row"><label for="balance-' + account.id + '">' + escapeHtml(account.name) + '</label>' +
    '<input type="number" inputmode="decimal" min="0" step="0.01" id="balance-' + account.id +
    '" name="balance-' + account.id + '" value="' + (account.balanceCents / 100).toFixed(2) + '" required aria-label="' +
    escapeHtml(account.name) + ' balance in pesos"></div>';
}
function bankInitializePage() {
  return backLink('/settings/initialize', 'Initialize') +
    pageHeader('Initialize', 'Bank balances', 'Set the current amount in each bank or e-wallet.') +
    '<form id="banks-form" class="form-panel" novalidate>' +
    bankAccounts().map(balanceInput).join('') +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button class="btn-primary-custom mt-3" type="submit">Save bank balances</button></form>' +
    '<div class="info-panel">Use each account\'s current balance. Changing an amount creates an adjustment in the ledger.</div>';
}
function onHandInitializePage() {
  const account = getAccount('on-hand');
  return backLink('/settings/initialize', 'Initialize') +
    pageHeader('Initialize', 'On-hand cash', 'Set the amount of physical cash you have available.') +
    '<form id="on-hand-form" class="form-panel" novalidate><div class="field">' +
    '<label for="balance-on-hand">On-hand amount (₱)</label>' +
    '<input class="form-control" type="number" inputmode="decimal" min="0" step="0.01" id="balance-on-hand" name="balance-on-hand" value="' +
    (account.balanceCents / 100).toFixed(2) + '" required></div>' +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button class="btn-primary-custom" type="submit">Save on-hand amount</button></form>' +
    '<div class="info-panel">This sets the current on-hand amount and records any change as a ledger adjustment.</div>';
}
function notFound() {
  return pageHeader('Not found', 'Page unavailable', 'This screen does not exist.') +
    '<a class="btn-primary-custom" href="#/dashboard">Return to dashboard</a>';
}
function currentRoute() {
  const hash = (location.hash || '#/dashboard').slice(1);
  const questionMark = hash.indexOf('?');
  const pathname = questionMark < 0 ? hash : hash.slice(0, questionMark);
  const query = questionMark < 0 ? '' : hash.slice(questionMark + 1);
  return { path: pathname.replace(/\/+$/, '') || '/dashboard', params: new URLSearchParams(query) };
}
function render() {
  const { path, params } = currentRoute();
  let body;
  if (path === '/dashboard') body = dashboard();
  else if (path === '/ledger') body = ledgerPage();
  else if (path === '/cash-in' || path === '/cash-out') body = movementPage(path.slice(1));
  else if (path === '/record/cash-in' || path === '/record/cash-out') body = movementForm(path.split('/')[2], params);
  else if (path.startsWith('/account/')) body = accountPage(decodeURIComponent(path.slice(9)));
  else if (path === '/settings') body = settingsPage();
  else if (path === '/settings/initialize') body = initializePage();
  else if (path === '/settings/initialize/banks') body = bankInitializePage();
  else if (path === '/settings/initialize/on-hand') body = onHandInitializePage();
  else body = notFound();
  view.innerHTML = body;
  const tab = path.startsWith('/settings') ? 'settings' : path.includes('cash-in') ? 'cash-in' : path.includes('cash-out') ? 'cash-out' : 'dashboard';
  document.querySelectorAll('[data-tab]').forEach((link) => {
    const active = link.dataset.tab === tab;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
function notify(text, error = false) {
  clearTimeout(noticeTimeout);
  message.textContent = text;
  message.classList.toggle('error', error);
  message.hidden = false;
  noticeTimeout = setTimeout(() => { message.hidden = true; }, 4500);
}
function formError(form, text) {
  const field = form.querySelector('#form-error');
  if (field) {
    field.textContent = text;
    field.hidden = !text;
  }
}
function updateAvailable() {
  const form = document.getElementById('movement-form');
  if (!form) return;
  const account = getAccount(form.elements.source.value);
  const label = document.getElementById('available-balance');
  if (label) label.textContent = 'Available: ' + pesos(account?.balanceCents || 0);
  const amount = form.elements.amount.value;
  if (form.dataset.kind === 'cash-out' && amount) {
    try {
      const cents = parsePesos(amount);
      formError(form, account && cents > account.balanceCents ? 'Insufficient balance in ' + account.name + '.' : '');
    } catch (error) {
      formError(form, error.message);
    }
  } else formError(form, '');
}
async function onSubmit(event) {
  const form = event.target;
  if (!['movement-form', 'banks-form', 'on-hand-form'].includes(form.id)) return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  formError(form, '');
  try {
    let destination;
    let successText;
    if (form.id === 'movement-form') {
      const kind = form.dataset.kind;
      const sourceId = form.elements.source.value;
      const amountCents = parsePesos(form.elements.amount.value);
      const date = form.elements.date.value;
      if (!validDate(date)) throw new Error('Please select a valid date.');
      await recordMovement({ kind, sourceId, amountCents, date });
      destination = '#/' + kind;
      successText = (kind === 'cash-in' ? 'Cash in' : 'Cash out') + ' saved.';
    } else {
      const accounts = form.id === 'banks-form' ? bankAccounts() : [getAccount('on-hand')];
      const entries = accounts.map((account) => ({
        id: account.id,
        balanceCents: parsePesos(form.elements.namedItem('balance-' + account.id).value, true)
      }));
      await saveStartingBalances(entries);
      destination = '#/settings/initialize';
      successText = form.id === 'banks-form' ? 'Bank balances saved.' : 'On-hand amount saved.';
    }
    snapshot = await getSnapshot();
    if (location.hash === destination) render();
    else location.hash = destination;
    notify(successText);
  } catch (error) {
    formError(form, error.message || 'Unable to save. Please try again.');
    submit.disabled = false;
  } finally {
    busy = false;
  }
}
async function start() {
  view.innerHTML = '<p class="page-subtitle">Loading your money tracker…</p>';
  try {
    snapshot = await getSnapshot();
    render();
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
    view.addEventListener('submit', onSubmit);
    view.addEventListener('change', (event) => {
      if (event.target.id === 'source') updateAvailable();
    });
    view.addEventListener('input', (event) => {
      if (event.target.id === 'amount') updateAvailable();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  } catch (error) {
    view.innerHTML = pageHeader('Storage unavailable', 'Unable to open Money Tracker') +
      '<div class="empty-state">' + escapeHtml(error.message || 'Could not open your local money data.') +
      '<p class="mt-2">Use a modern browser, enable site storage, and reload this page.</p></div>';
    notify('Local data is unavailable.', true);
  }
}
start();
