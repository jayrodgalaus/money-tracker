// IndexedDB is the only persistent source of truth. Monetary values are integer centavos.
export const ACCOUNT_DEFS = Object.freeze([
  { id: 'bdo', name: 'BDO', kind: 'bank', symbol: 'BD' },
  { id: 'bpi', name: 'BPI', kind: 'bank', symbol: 'BP' },
  { id: 'gcash', name: 'GCash', kind: 'bank', symbol: 'GC' },
  { id: 'gotyme', name: 'GoTyme', kind: 'bank', symbol: 'GT' },
  { id: 'maribank', name: 'MariBank', kind: 'bank', symbol: 'MB' },
  { id: 'ownbank', name: 'OwnBank', kind: 'bank', symbol: 'OB' },
  { id: 'rcbc', name: 'RCBC', kind: 'bank', symbol: 'RC' },
  { id: 'wise', name: 'Wise', kind: 'bank', symbol: 'WI' },
  { id: 'on-hand', name: 'On-hand', kind: 'cash', symbol: '₱' }
]);

const NAME = 'money-tracker';
const VERSION = 2;
const accountIds = new Set(ACCOUNT_DEFS.map((account) => account.id));
let connectionPromise;

export function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function parsePesos(value, allowZero = false) {
  const input = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input)) {
    throw new Error('Enter a valid peso amount with up to two decimal places.');
  }
  const [whole, decimal = ''] = input.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || (allowZero ? cents < 0 : cents <= 0)) {
    throw new Error(allowZero ? 'Enter a valid, non-negative amount.' : 'Amount must be greater than zero.');
  }
  return cents;
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('IndexedDB is unavailable. Use a modern browser with site storage enabled.'));
  }
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion < 1) {
        const accounts = database.createObjectStore('accounts', { keyPath: 'id' });
        const transactions = database.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        transactions.createIndex('date', 'date');
        transactions.createIndex('sourceId', 'sourceId');
        transactions.createIndex('kind', 'kind');
        ACCOUNT_DEFS.forEach((account) => accounts.put({ ...account, balanceCents: 0, initialized: false }));
      }
      // Upgrade existing installations without overwriting saved balances or transactions.
      if (event.oldVersion === 1) {
        const ownBank = ACCOUNT_DEFS.find((account) => account.id === 'ownbank');
        request.transaction.objectStore('accounts').add({ ...ownBank, balanceCents: 0, initialized: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connectionPromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
    request.onblocked = () => reject(new Error('A different tab is blocking the database. Close other tabs and reload.'));
  }).catch((error) => {
    connectionPromise = undefined;
    throw error;
  });
  return connectionPromise;
}

function transactionFailure(tx, reject, fallback) {
  tx.onerror = () => reject(tx.error || new Error(fallback));
  tx.onabort = () => reject(tx.error || new Error(fallback));
}

export async function getSnapshot() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['accounts', 'transactions'], 'readonly');
    const accounts = tx.objectStore('accounts').getAll();
    const transactions = tx.objectStore('transactions').getAll();
    tx.oncomplete = () => resolve({ accounts: accounts.result, transactions: transactions.result });
    transactionFailure(tx, reject, 'Unable to read saved money data.');
  });
}

export async function recordMovement({ kind, sourceId, amountCents, date }) {
  if (kind !== 'cash-in' && kind !== 'cash-out') throw new Error('Invalid transaction type.');
  if (!accountIds.has(sourceId)) throw new Error('Choose a valid source.');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Enter an amount greater than zero.');
  if (!validDate(date)) throw new Error('Choose a valid date.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['accounts', 'transactions'], 'readwrite');
    const accounts = tx.objectStore('accounts');
    const transactions = tx.objectStore('transactions');
    let businessError;
    const request = accounts.get(sourceId);
    request.onsuccess = () => {
      const account = request.result;
      if (!account) {
        businessError = new Error('Source was not found.');
        tx.abort();
        return;
      }
      if (kind === 'cash-out' && amountCents > account.balanceCents) {
        businessError = new Error('Insufficient balance in ' + account.name + '.');
        tx.abort();
        return;
      }
      const delta = kind === 'cash-in' ? amountCents : -amountCents;
      const next = account.balanceCents + delta;
      if (!Number.isSafeInteger(next)) {
        businessError = new Error('The resulting balance is too large.');
        tx.abort();
        return;
      }
      accounts.put({ ...account, balanceCents: next });
      transactions.add({ kind, sourceId, amountCents: delta, date, createdAt: new Date().toISOString() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(businessError || tx.error || new Error('Could not save transaction.'));
    tx.onabort = () => reject(businessError || tx.error || new Error('Could not save transaction.'));
  });
}

// Set current balances atomically. Any change is logged as an adjustment, never
// as cash-in or cash-out, so monthly movement totals remain accurate.
export async function saveStartingBalances(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('No balances to save.');
  const seen = new Set();
  for (const entry of entries) {
    if (!accountIds.has(entry.id) || seen.has(entry.id) || !Number.isSafeInteger(entry.balanceCents) || entry.balanceCents < 0) {
      throw new Error('Invalid balance or duplicate source.');
    }
    seen.add(entry.id);
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['accounts', 'transactions'], 'readwrite');
    const accounts = tx.objectStore('accounts');
    const transactions = tx.objectStore('transactions');
    const date = todayLocal();
    let businessError;
    entries.forEach((entry) => {
      const request = accounts.get(entry.id);
      request.onsuccess = () => {
        const account = request.result;
        if (!account) {
          businessError = new Error('Could not find source: ' + entry.id);
          tx.abort();
          return;
        }
        const delta = entry.balanceCents - account.balanceCents;
        accounts.put({ ...account, balanceCents: entry.balanceCents, initialized: true });
        if (delta !== 0) {
          transactions.add({
            kind: 'adjustment',
            sourceId: entry.id,
            amountCents: delta,
            date,
            createdAt: new Date().toISOString(),
            note: account.initialized ? 'Balance adjustment' : 'Opening balance'
          });
        }
      };
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(businessError || tx.error || new Error('Could not save starting balances.'));
    tx.onabort = () => reject(businessError || tx.error || new Error('Could not save starting balances.'));
  });
}
