import { ACCOUNT_DEFS, getSnapshot, parsePesos, recordMovement, recordTransfer, saveStartingBalances, addBank, todayLocal, validDate } from './db.js?v=7';
import { loadBankDirectory } from './bank-directory.js?v=7';

const view = document.getElementById('view');
const stage = document.getElementById('page-stage');
const bottomNav = document.querySelector('.bottom-nav');
const message = document.getElementById('message');
const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
const longDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' });
let snapshot = { accounts: [], transactions: [] };
let busy = false;
let noticeTimeout;
let activePanel;
let currentPath;
let transitionTimeout;
let lastScrollY = window.scrollY;
let suggestionMatches = [];
let selectedSuggestion = -1;

// Keep the bottom tabs available when scrolling upward or navigating.
function showBottomNav() {
  bottomNav.classList.remove('is-hidden');
  bottomNav.removeAttribute('inert');
}
function onScroll() {
  const position = Math.max(0, window.scrollY);
  const difference = position - lastScrollY;
  if (position <= 48 || difference < -7) {
    showBottomNav();
  } else if (difference > 7 && position > 90) {
    bottomNav.classList.add('is-hidden');
    bottomNav.setAttribute('inert', '');
  }
  if (Math.abs(difference) > 4 || position <= 48) lastScrollY = position;
}

// Top-level tabs are peers. Ledger, accounts and Initialize are deeper screens.
function pageDepth(path) {
  if (path === '/settings/initialize/banks/add') return 3;
  if (path === '/settings/initialize/banks' || path === '/settings/initialize/on-hand' || path.startsWith('/record/')) return 2;
  if (path === '/ledger' || path.startsWith('/account/') || path === '/settings/initialize') return 1;
  return 0;
}
function motionReduced() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function displayPage(html, path, previousScroll = 0) {
  const next = document.createElement('div');
  next.className = 'page-panel';
  next.innerHTML = html;
  clearTimeout(transitionTimeout);

  // If another navigation occurred mid-animation, finish it before starting a new one.
  if (activePanel) {
    activePanel.className = 'page-panel';
    stage.replaceChildren(activePanel);
  } else {
    stage.replaceChildren();
  }
  const previous = activePanel;
  const oldPath = currentPath;
  currentPath = path;
  activePanel = next;

  if (!previous || oldPath === path || motionReduced()) {
    stage.replaceChildren(next);
    return;
  }

  const oldDepth = pageDepth(oldPath);
  const newDepth = pageDepth(path);
  const direction = newDepth < oldDepth ? 'back' : newDepth > oldDepth ? 'forward' : 'lateral';
  previous.className = 'page-panel is-leaving is-leaving-' + direction;
  // Preserve the outgoing screen's visible scroll position while the new one starts at the top.
  previous.style.top = -previousScroll + 'px';
  previous.setAttribute('aria-hidden', 'true');
  previous.setAttribute('inert', '');
  next.className = 'page-panel is-entering-' + direction;
  stage.append(next);
  // The old page is above the incoming page when navigating back, so it slides off to the right.
  const finish = () => {
    if (activePanel !== next) return;
    next.className = 'page-panel';
    stage.replaceChildren(next);
  };
  // Forward and peer navigation animate the new page; back navigation
  // animates the outgoing page, leaving the destination still beneath it.
  const animatedPanel = direction === 'back' ? previous : next;
  animatedPanel.addEventListener('animationend', (event) => {
    if (event.target === animatedPanel) {
      clearTimeout(transitionTimeout);
      finish();
    }
  }, { once: true });
  transitionTimeout = setTimeout(finish, 380);
}

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
function transactionRow(entry, accountId = null) {
  if (entry.kind === 'transfer') {
    const from = getAccount(entry.fromId)?.name || 'Unknown bank';
    const to = getAccount(entry.toId)?.name || 'Unknown bank';
    const incoming = accountId === entry.toId;
    const outgoing = accountId === entry.fromId;
    const amountClass = incoming ? 'positive' : outgoing ? 'negative' : 'neutral';
    const prefix = incoming ? '+' : outgoing ? '−' : '';
    const label = incoming ? 'Transfer received' : outgoing ? 'Transfer sent' : 'Transfer';
    return '<div class="transaction-row">' +
      '<span class="transaction-icon transfer" aria-hidden="true">⇄</span>' +
      '<div class="transaction-main"><strong>' + escapeHtml(from) + ' → ' + escapeHtml(to) + '</strong>' +
      '<small>' + label + ' · ' + displayDate(entry.date) + '</small></div>' +
      '<span class="transaction-amount ' + amountClass + '">' + prefix + pesos(entry.amountCents) + '</span></div>';
  }
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
function transactionList(transactions, context, accountId = null) {
  if (!transactions.length) {
    return emptyState('No activity yet', 'Your ' + context + ' will appear here as you record them.');
  }
  return '<div class="transaction-list">' + sortedTransactions(transactions).map((entry) => transactionRow(entry, accountId)).join('') + '</div>';
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
    pageHeader('Activity', 'Transaction ledger', 'Every cash movement, transfer, and balance adjustment, newest date first.') +
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

function transferPage() {
  const transfers = snapshot.transactions.filter((entry) => entry.kind === 'transfer');
  return backLink('/dashboard', 'Dashboard') +
    pageHeader('Money movement', 'Transfers', 'Move money between banks without changing your total amount.') +
    '<a class="btn-primary-custom w-100" href="#/record/transfer">⇄ Record transfer</a>' +
    sectionHeading('Recorded transfers', transfers.length + ' entries') +
    transactionList(transfers, 'transfers');
}
function transferForm(params) {
  const banks = bankAccounts();
  if (banks.length < 2) {
    return backLink('/transfer', 'Transfers') +
      pageHeader('New transaction', 'Record transfer') +
      emptyState('Two banks required', 'Add at least two bank accounts to record a transfer.',
        '/settings/initialize/banks/add', 'Add a bank');
  }
  const requested = params.get('from');
  const fromId = banks.some((account) => account.id === requested) ? requested : banks[0].id;
  const toId = banks.find((account) => account.id !== fromId).id;
  const options = (chosen) => banks.map((account) =>
    '<option value="' + escapeHtml(account.id) + '"' + (account.id === chosen ? ' selected' : '') +
    '>' + escapeHtml(account.name) + '</option>').join('');
  return backLink('/transfer', 'Transfers') +
    pageHeader('New transaction', 'Record transfer', 'Move funds from one bank account to another.') +
    '<form id="transfer-form" class="form-panel" novalidate>' +
    '<div class="field"><label for="from-bank">From bank</label>' +
    '<select class="form-select" id="from-bank" name="from-bank" required>' + options(fromId) + '</select>' +
    '<p class="field-help" id="transfer-available">Available: ' +
    pesos(getAccount(fromId)?.balanceCents || 0) + '</p></div>' +
    '<div class="field"><label for="to-bank">To bank</label>' +
    '<select class="form-select" id="to-bank" name="to-bank" required>' + options(toId) + '</select></div>' +
    '<div class="field"><label for="transfer-amount">Amount (₱)</label>' +
    '<input class="form-control" type="number" id="transfer-amount" name="transfer-amount" ' +
    'min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></div>' +
    '<div class="field"><label for="transfer-date">Date</label>' +
    '<input class="form-control" type="date" id="transfer-date" name="transfer-date" ' +
    'value="' + todayLocal() + '" required></div>' +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button type="submit" class="btn-primary-custom">Save transfer</button></form>' +
    '<div class="info-panel">Transfers do not count as Cash In or Cash Out and do not change the Total Amount.</div>';
}
function accountPage(id) {
  const account = getAccount(id);
  if (!account) return notFound();
  const transactions = snapshot.transactions.filter((entry) =>
    entry.sourceId === id || (entry.kind === 'transfer' && (entry.fromId === id || entry.toId === id)));
  const suffix = '?source=' + encodeURIComponent(id);
  return backLink('/dashboard', 'Dashboard') +
    pageHeader(account.kind === 'bank' ? 'Bank / e-wallet' : 'Physical cash', account.name, 'Your current available balance and history.') +
    '<div class="detail-card"><div class="label">Available balance</div><div class="amount">' + pesos(account.balanceCents) + '</div></div>' +
    '<div class="action-row"><a class="btn-primary-custom" href="#/record/cash-in' + suffix + '">+ Cash in</a>' +
    '<a class="btn-secondary-custom" href="#/record/cash-out' + suffix + '">− Cash out</a></div>' +
    sectionHeading('Account activity', transactions.length + ' entries') +
    transactionList(transactions, account.name + ' transactions', id);
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
    '<span class="account-description"><strong>Banks<small>View, initialize, or add bank accounts</small></strong></span><span class="chevron" aria-hidden="true">›</span></a>' +
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
    '<div class="bank-add-slot"><a class="bank-add-button" href="#/settings/initialize/banks/add" aria-label="Add another bank" title="Add another bank">+</a></div>' +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button class="btn-primary-custom mt-3" type="submit">Save bank balances</button></form>' +
    '<div class="info-panel">Use each account\'s current balance. Changing an amount creates an adjustment in the ledger.</div>';
}
function addBankPage() {
  return backLink('/settings/initialize/banks', 'Bank balances') +
    pageHeader('Initialize', 'Add another bank', 'Choose a bank from the directory or enter your own name.') +
    '<form id="new-bank-form" class="form-panel" novalidate>' +
    '<div class="field bank-combobox"><label for="bank-name">Bank name</label>' +
    '<div class="bank-search-control"><input class="form-control" type="text" id="bank-name" name="bank-name" role="combobox" ' +
    'aria-autocomplete="list" aria-expanded="false" aria-controls="bank-suggestions" ' +
    'aria-haspopup="listbox" autocomplete="off" maxlength="120" placeholder="Start typing a bank name" required>' +
    '<div id="bank-suggestions" class="bank-suggestions" role="listbox" aria-label="Matching banks" hidden></div></div>' +
    '<p class="field-help">Suggestions come from your bank directory. Other bank names are also accepted.</p></div>' +
    '<div class="field"><label for="initial-amount">Initial amount (₱)</label>' +
    '<input class="form-control" type="number" id="initial-amount" name="initial-amount" ' +
    'min="0" step="0.01" inputmode="decimal" value="0.00" required></div>' +
    '<p id="form-error" class="field-error" role="alert" hidden></p>' +
    '<button class="btn-primary-custom" type="submit">Save new bank</button></form>';
}
function hideBankSuggestions() {
  const input = activePanel?.querySelector('#bank-name');
  const list = activePanel?.querySelector('#bank-suggestions');
  if (!input || !list) return;
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  selectedSuggestion = -1;
}
async function updateBankSuggestions() {
  const panel = activePanel;
  const input = panel?.querySelector('#bank-name');
  const list = panel?.querySelector('#bank-suggestions');
  if (!input || !list) return;
  const term = input.value.trim().toLocaleLowerCase();
  suggestionMatches = [];
  selectedSuggestion = -1;
  if (!term) {
    hideBankSuggestions();
    return;
  }
  try {
    const banks = await loadBankDirectory();
    if (activePanel !== panel || input.value.trim().toLocaleLowerCase() !== term) return;
    // Start-of-name matches first, then other partial matches. Limit on-screen options.
    suggestionMatches = banks.filter((bank) => bank.toLocaleLowerCase().includes(term))
      .sort((a, b) => Number(b.toLocaleLowerCase().startsWith(term)) -
                        Number(a.toLocaleLowerCase().startsWith(term))).slice(0, 8);
    list.innerHTML = suggestionMatches.map((bank, i) =>
      '<button type="button" role="option" id="bank-option-' + i +
      '" aria-selected="false" class="bank-suggestion" data-bank-suggestion="' + i + '">' +
      escapeHtml(bank) + '</button>').join('');
    list.hidden = suggestionMatches.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  } catch {
    // Suggestions are optional; names not present in the directory remain valid.
    hideBankSuggestions();
  }
}
function selectBankSuggestion(index) {
  const input = activePanel?.querySelector('#bank-name');
  if (!input || !suggestionMatches[index]) return;
  input.value = suggestionMatches[index];
  hideBankSuggestions();
  input.focus();
}
function onBankNameKeydown(event) {
  const input = event.target;
  const list = activePanel?.querySelector('#bank-suggestions');
  if (!list || list.hidden || !suggestionMatches.length) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    hideBankSuggestions();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    selectedSuggestion = selectedSuggestion < 0
      ? (offset > 0 ? 0 : suggestionMatches.length - 1)
      : (selectedSuggestion + offset + suggestionMatches.length) % suggestionMatches.length;
    list.querySelectorAll('[data-bank-suggestion]').forEach((option, i) => {
      const active = i === selectedSuggestion;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
    });
    input.setAttribute('aria-activedescendant', 'bank-option-' + selectedSuggestion);
    list.querySelector('#bank-option-' + selectedSuggestion)?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && selectedSuggestion >= 0) {
    event.preventDefault();
    selectBankSuggestion(selectedSuggestion);
  }
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
function render(previousScroll = 0) {
  const { path, params } = currentRoute();
  let body;
  if (path === '/dashboard') body = dashboard();
  else if (path === '/ledger') body = ledgerPage();
  else if (path === '/cash-in' || path === '/cash-out') body = movementPage(path.slice(1));
  else if (path === '/transfer') body = transferPage();
  else if (path === '/record/transfer') body = transferForm(params);
  else if (path === '/record/cash-in' || path === '/record/cash-out') body = movementForm(path.split('/')[2], params);
  else if (path.startsWith('/account/')) body = accountPage(decodeURIComponent(path.slice(9)));
  else if (path === '/settings') body = settingsPage();
  else if (path === '/settings/initialize') body = initializePage();
  else if (path === '/settings/initialize/banks') body = bankInitializePage();
  else if (path === '/settings/initialize/banks/add') body = addBankPage();
  else if (path === '/settings/initialize/on-hand') body = onHandInitializePage();
  else body = notFound();
  displayPage(body, path, previousScroll);
  const tab = path.startsWith('/settings') ? 'settings' :
    path === '/transfer' || path === '/record/transfer' ? 'transfer' :
    path.includes('cash-in') ? 'cash-in' : path.includes('cash-out') ? 'cash-out' : 'dashboard';
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
  const form = activePanel?.querySelector('#movement-form');
  if (!form) return;
  const account = getAccount(form.elements.source.value);
  const label = form.querySelector('#available-balance');
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

function updateTransferPreview() {
  const form = activePanel?.querySelector('#transfer-form');
  if (!form) return;
  const fromId = form.elements.namedItem('from-bank').value;
  const toId = form.elements.namedItem('to-bank').value;
  const fromAccount = snapshot.accounts.find((account) => account.id === fromId && account.kind === 'bank');
  const available = form.querySelector('#transfer-available');
  if (available) available.textContent = 'Available: ' + pesos(fromAccount?.balanceCents || 0);
  if (fromId === toId) {
    formError(form, 'Choose two different banks.');
    return;
  }
  const raw = form.elements.namedItem('transfer-amount').value;
  if (!raw) {
    formError(form, '');
    return;
  }
  try {
    const amountCents = parsePesos(raw);
    formError(form, fromAccount && amountCents > fromAccount.balanceCents ?
      'Insufficient balance in ' + fromAccount.name + '.' : '');
  } catch (error) {
    formError(form, error.message);
  }
}
async function onSubmit(event) {
  const form = event.target;
  if (!['movement-form', 'banks-form', 'on-hand-form', 'new-bank-form', 'transfer-form'].includes(form.id)) return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  formError(form, '');
  try {
    let destination;
    let successText;
    if (form.id === 'transfer-form') {
      const fromId = form.elements.namedItem('from-bank').value;
      const toId = form.elements.namedItem('to-bank').value;
      const amountCents = parsePesos(form.elements.namedItem('transfer-amount').value);
      const date = form.elements.namedItem('transfer-date').value;
      await recordTransfer({ fromId, toId, amountCents, date });
      destination = '#/transfer';
      successText = 'Transfer saved.';
    } else if (form.id === 'new-bank-form') {
      const name = form.elements.namedItem('bank-name').value;
      const initialCents = parsePesos(form.elements.namedItem('initial-amount').value, true);
      await addBank({ name, initialCents });
      destination = '#/settings/initialize/banks';
      successText = 'Bank added.';
    } else if (form.id === 'movement-form') {
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
  stage.innerHTML = '<p class="page-subtitle">Loading your money tracker…</p>';
  try {
    snapshot = await getSnapshot();
    render();
    window.addEventListener('hashchange', () => {
      const previousScroll = window.scrollY;
      // Start the incoming page at the top while the outgoing page keeps its visual position.
      window.scrollTo(0, 0);
      lastScrollY = 0;
      showBottomNav();
      render(previousScroll);
      view.focus({ preventScroll: true });
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    bottomNav.addEventListener('focusin', showBottomNav);
    view.addEventListener('submit', onSubmit);
    view.addEventListener('change', (event) => {
      if (event.target.id === 'source') updateAvailable();
      if (event.target.id === 'from-bank' || event.target.id === 'to-bank') updateTransferPreview();
    });
    view.addEventListener('input', (event) => {
      if (event.target.id === 'amount') updateAvailable();
      if (event.target.id === 'transfer-amount') updateTransferPreview();
      if (event.target.id === 'bank-name') updateBankSuggestions();
    });
    view.addEventListener('focusin', (event) => {
      if (event.target.id === 'bank-name') updateBankSuggestions();
    });
    view.addEventListener('keydown', (event) => {
      if (event.target.id === 'bank-name') onBankNameKeydown(event);
    });
    view.addEventListener('click', (event) => {
      const option = event.target.closest('[data-bank-suggestion]');
      if (option) selectBankSuggestion(Number(option.dataset.bankSuggestion));
      else if (event.target.id !== 'bank-name') hideBankSuggestions();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  } catch (error) {
    stage.innerHTML = pageHeader('Storage unavailable', 'Unable to open Money Tracker') +
      '<div class="empty-state">' + escapeHtml(error.message || 'Could not open your local money data.') +
      '<p class="mt-2">Use a modern browser, enable site storage, and reload this page.</p></div>';
    notify('Local data is unavailable.', true);
  }
}
start();
