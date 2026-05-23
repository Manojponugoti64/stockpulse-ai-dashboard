import { ChartManager } from './charts.js';

// ─── API Client ───────────────────────────────────────────────────────────────
const API = {
  async getQuote(symbol) {
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`Failed to fetch quote for ${symbol}`);
    return res.json();
  },

  async getQuotes(symbols) {
    if (!symbols.length) return [];
    const res = await fetch(`/api/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}`);
    if (!res.ok) throw new Error('Failed to fetch quotes');
    return res.json();
  },

  async searchStocks(query) {
    const res = await fetch(`/api/search/${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  async getHistory(symbol, period = '1mo') {
    const res = await fetch(`/api/history/${encodeURIComponent(symbol)}?period=${period}`);
    if (!res.ok) throw new Error('Failed to fetch history');
    return res.json();
  },

  async getMarketStatus() {
    const res = await fetch('/api/market-status');
    if (!res.ok) throw new Error('Failed to fetch market status');
    return res.json();
  },

  async getAdvisorAnalysis(symbols) {
    if (!symbols || !symbols.length) return [];
    const res = await fetch(`/api/advisor/analyze?symbols=${symbols.map(encodeURIComponent).join(',')}`);
    if (!res.ok) throw new Error('Failed to fetch advisor analysis');
    return res.json();
  },

  async getNewsSentiment(refresh = false) {
    const res = await fetch(`/api/advisor/news-sentiment${refresh ? '?refresh=true' : ''}`);
    if (!res.ok) throw new Error('Failed to fetch news sentiment');
    return res.json();
  },
};

// ─── Format Helpers ───────────────────────────────────────────────────────────
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 2,
});

function formatCurrency(num) {
  if (num == null || isNaN(num)) return '₹0.00';
  return currencyFormatter.format(num);
}

function formatPercent(num) {
  if (num == null || isNaN(num)) return '0.00%';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function formatLargeNumber(num) {
  if (num == null || isNaN(num)) return '₹0';
  if (Math.abs(num) >= 1e7) return `₹${(num / 1e7).toFixed(2)}Cr`;
  if (Math.abs(num) >= 1e5) return `₹${(num / 1e5).toFixed(2)}L`;
  return formatCurrency(num);
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Default Portfolio (Manoj's Holdings) ─────────────────────────────────────
const DEFAULT_PORTFOLIO = {
  holdings: [
    {
      id: 'default-1',
      symbol: 'NEXT50IETF',
      name: 'Nippon India ETF Nifty Next 50 Junior BeES',
      quantity: 1,
      avgPrice: 72.97,
      buyDate: null,
      sector: 'Other',
    },
    {
      id: 'default-2',
      symbol: 'PHARMABEES',
      name: 'Nippon India ETF Nifty Pharma',
      quantity: 14,
      avgPrice: 24.85,
      buyDate: null,
      sector: 'Pharma',
    },
  ],
  watchlist: [
    {
      id: 'watch-1',
      symbol: 'NIFTYBEES',
      name: 'Nippon India ETF Nifty BeES',
      targetPrice: null,
    },
    {
      id: 'watch-2',
      symbol: 'GOLDBEES',
      name: 'Nippon India ETF Gold BeES',
      targetPrice: null,
    },
  ],
};

// ─── Portfolio Manager ────────────────────────────────────────────────────────
class PortfolioManager {
  constructor() {
    this.STORAGE_KEY = 'stockpulse_portfolio';
    this.holdings = [];
    this.watchlist = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
      if (data && (data.holdings?.length || data.watchlist?.length)) {
        this.holdings = data.holdings || [];
        this.watchlist = data.watchlist || [];
      } else {
        // First time — load default portfolio
        this.holdings = [...DEFAULT_PORTFOLIO.holdings];
        this.watchlist = [...DEFAULT_PORTFOLIO.watchlist];
        this.save();
      }
    } catch {
      this.holdings = [...DEFAULT_PORTFOLIO.holdings];
      this.watchlist = [...DEFAULT_PORTFOLIO.watchlist];
      this.save();
    }
  }

  save() {
    const data = {
      holdings: this.holdings.map(h => ({
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        buyDate: h.buyDate,
        sector: h.sector,
      })),
      watchlist: this.watchlist.map(w => ({
        id: w.id,
        symbol: w.symbol,
        name: w.name,
        targetPrice: w.targetPrice,
      })),
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  }

  addHolding(holding) {
    holding.id = holding.id || crypto.randomUUID();
    holding.ltp = 0;
    holding.change = 0;
    holding.changePercent = 0;
    this.holdings.push(holding);
    this.save();
    return holding;
  }

  updateHolding(id, updates) {
    const idx = this.holdings.findIndex(h => h.id === id);
    if (idx !== -1) {
      Object.assign(this.holdings[idx], updates);
      this.save();
    }
  }

  removeHolding(id) {
    this.holdings = this.holdings.filter(h => h.id !== id);
    this.save();
  }

  addToWatchlist(item) {
    item.id = item.id || crypto.randomUUID();
    item.ltp = 0;
    item.change = 0;
    item.changePercent = 0;
    // Don't add duplicates
    if (this.watchlist.some(w => w.symbol === item.symbol)) return null;
    this.watchlist.push(item);
    this.save();
    return item;
  }

  removeFromWatchlist(id) {
    this.watchlist = this.watchlist.filter(w => w.id !== id);
    this.save();
  }

  getPortfolioSummary() {
    let totalInvested = 0;
    let currentValue = 0;
    let dayPL = 0;

    for (const h of this.holdings) {
      totalInvested += h.avgPrice * h.quantity;
      const ltp = h.ltp || h.avgPrice;
      currentValue += ltp * h.quantity;
      dayPL += (h.change || 0) * h.quantity;
    }

    const totalPL = currentValue - totalInvested;
    const totalPLPercent = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const dayPLPercent = (currentValue - dayPL) > 0 ? (dayPL / (currentValue - dayPL)) * 100 : 0;

    return { totalInvested, currentValue, totalPL, totalPLPercent, dayPL, dayPLPercent };
  }

  exportJSON() {
    return JSON.stringify({
      holdings: this.holdings.map(h => ({
        id: h.id, symbol: h.symbol, name: h.name,
        quantity: h.quantity, avgPrice: h.avgPrice,
        buyDate: h.buyDate, sector: h.sector,
      })),
      watchlist: this.watchlist.map(w => ({
        id: w.id, symbol: w.symbol, name: w.name,
        targetPrice: w.targetPrice,
      })),
    }, null, 2);
  }

  importJSON(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.holdings) this.holdings = data.holdings;
    if (data.watchlist) this.watchlist = data.watchlist;
    this.save();
  }
}

// ─── UI Controller ────────────────────────────────────────────────────────────
class UIController {
  constructor(portfolio, chartManager) {
    this.portfolio = portfolio;
    this.chartManager = chartManager;
    this.sortColumn = null;
    this.sortDirection = 'asc';
    this.selectedStock = null;
    this.selectedPeriod = '1mo';
  }

  renderSummaryCards() {
    const summary = this.portfolio.getPortfolioSummary();

    const investedEl = document.getElementById('totalInvested');
    const currentEl = document.getElementById('currentValue');
    const plEl = document.getElementById('totalPL');
    const plPctEl = document.getElementById('totalPLPercent');
    const dayPLEl = document.getElementById('dayPL');
    const dayPLPctEl = document.getElementById('dayPLPercent');

    if (investedEl) investedEl.textContent = formatCurrency(summary.totalInvested);
    if (currentEl) currentEl.textContent = formatCurrency(summary.currentValue);

    if (plEl) {
      plEl.textContent = formatCurrency(summary.totalPL);
      plEl.className = `card-value ${summary.totalPL >= 0 ? 'positive' : 'negative'}`;
    }
    if (plPctEl) {
      plPctEl.textContent = formatPercent(summary.totalPLPercent);
      plPctEl.className = `card-sub ${summary.totalPLPercent >= 0 ? 'positive' : 'negative'}`;
    }

    if (dayPLEl) {
      dayPLEl.textContent = formatCurrency(summary.dayPL);
      dayPLEl.className = `card-value ${summary.dayPL >= 0 ? 'positive' : 'negative'}`;
    }
    if (dayPLPctEl) {
      dayPLPctEl.textContent = formatPercent(summary.dayPLPercent);
      dayPLPctEl.className = `card-sub ${summary.dayPLPercent >= 0 ? 'positive' : 'negative'}`;
    }

    // Card border indicators
    const plCard = document.getElementById('cardTotalPL');
    const dayCard = document.getElementById('cardDayPL');
    if (plCard) {
      plCard.classList.toggle('positive', summary.totalPL >= 0);
      plCard.classList.toggle('negative', summary.totalPL < 0);
    }
    if (dayCard) {
      dayCard.classList.toggle('positive', summary.dayPL >= 0);
      dayCard.classList.toggle('negative', summary.dayPL < 0);
    }
  }

  renderHoldingsTable() {
    const tbody = document.getElementById('holdingsBody');
    const emptyState = document.getElementById('emptyState');
    const tableWrapper = document.getElementById('tableWrapper');

    if (!tbody) return;

    const holdings = this._getSortedHoldings();

    if (holdings.length === 0) {
      if (emptyState) emptyState.classList.add('visible');
      if (tableWrapper) tableWrapper.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.classList.remove('visible');
    if (tableWrapper) tableWrapper.style.display = 'block';

    tbody.innerHTML = holdings.map(h => {
      const ltp = h.ltp || 0;
      const pl = (ltp - h.avgPrice) * h.quantity;
      const plPct = h.avgPrice > 0 ? ((ltp - h.avgPrice) / h.avgPrice) * 100 : 0;
      const dayChg = (h.change || 0) * h.quantity;
      const dayChgPct = h.changePercent || 0;
      const plClass = pl >= 0 ? 'positive' : 'negative';
      const dayClass = dayChg >= 0 ? 'positive' : 'negative';

      return `
        <tr data-symbol="${h.symbol}" data-id="${h.id}">
          <td>
            <div class="stock-cell">
              <span class="stock-symbol">${h.symbol}</span>
              <span class="stock-name">${h.name || ''}</span>
            </div>
          </td>
          <td>${h.quantity}</td>
          <td>${formatCurrency(h.avgPrice)}</td>
          <td class="ltp-cell">${ltp > 0 ? formatCurrency(ltp) : '—'}</td>
          <td>
            <div class="pl-cell ${plClass}">
              <span class="pl-value">${ltp > 0 ? formatCurrency(pl) : '—'}</span>
              <span class="pl-percent">${ltp > 0 ? formatPercent(plPct) : ''}</span>
            </div>
          </td>
          <td class="${plClass}">${ltp > 0 ? formatPercent(plPct) : '—'}</td>
          <td>
            <div class="pl-cell ${dayClass}">
              <span class="pl-value">${ltp > 0 ? formatCurrency(dayChg) : '—'}</span>
              <span class="pl-percent">${ltp > 0 ? formatPercent(dayChgPct) : ''}</span>
            </div>
          </td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon btn-edit" data-id="${h.id}" aria-label="Edit ${h.symbol}" title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="btn-icon btn-danger btn-delete" data-id="${h.id}" aria-label="Delete ${h.symbol}" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Re-attach row click handlers
    tbody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-edit') || e.target.closest('.btn-delete')) return;
        const symbol = row.dataset.symbol;
        if (symbol) this._selectStockForChart(symbol);
      });
    });

    // Edit buttons
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openAddStockModal(btn.dataset.id);
      });
    });

    // Delete buttons
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const holding = this.portfolio.holdings.find(h => h.id === id);
        if (holding && confirm(`Remove ${holding.symbol} from your portfolio?`)) {
          this.portfolio.removeHolding(id);
          this.renderAll();
          this.showToast(`${holding.symbol} removed from portfolio`, 'info');
        }
      });
    });
  }

  _getSortedHoldings() {
    const holdings = [...this.portfolio.holdings];
    if (!this.sortColumn) return holdings;

    holdings.sort((a, b) => {
      let valA, valB;
      switch (this.sortColumn) {
        case 'symbol': valA = a.symbol; valB = b.symbol; break;
        case 'quantity': valA = a.quantity; valB = b.quantity; break;
        case 'avgPrice': valA = a.avgPrice; valB = b.avgPrice; break;
        case 'ltp': valA = a.ltp || 0; valB = b.ltp || 0; break;
        case 'pl':
          valA = ((a.ltp || a.avgPrice) - a.avgPrice) * a.quantity;
          valB = ((b.ltp || b.avgPrice) - b.avgPrice) * b.quantity;
          break;
        case 'plPercent':
          valA = a.avgPrice > 0 ? ((a.ltp || a.avgPrice) - a.avgPrice) / a.avgPrice : 0;
          valB = b.avgPrice > 0 ? ((b.ltp || b.avgPrice) - b.avgPrice) / b.avgPrice : 0;
          break;
        case 'dayChange':
          valA = (a.change || 0) * a.quantity;
          valB = (b.change || 0) * b.quantity;
          break;
        default: return 0;
      }

      if (typeof valA === 'string') {
        const cmp = valA.localeCompare(valB);
        return this.sortDirection === 'asc' ? cmp : -cmp;
      }
      return this.sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    return holdings;
  }

  renderWatchlist() {
    const list = document.getElementById('watchlistList');
    const empty = document.getElementById('watchlistEmpty');

    if (!list) return;

    if (this.portfolio.watchlist.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    list.innerHTML = this.portfolio.watchlist.map(w => {
      const changeClass = (w.changePercent || 0) >= 0 ? 'positive' : 'negative';
      return `
        <li class="watchlist-item" data-symbol="${w.symbol}">
          <div class="watchlist-item-left">
            <span class="watchlist-symbol">${w.symbol}</span>
            <span class="watchlist-name">${w.name || ''}</span>
          </div>
          <div class="watchlist-item-right">
            <div>
              <div class="watchlist-price">${w.ltp > 0 ? formatCurrency(w.ltp) : '—'}</div>
              <div class="watchlist-change ${changeClass}">${w.ltp > 0 ? formatPercent(w.changePercent || 0) : ''}</div>
            </div>
            <button class="watchlist-remove" data-id="${w.id}" aria-label="Remove ${w.symbol}" title="Remove">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </li>
      `;
    }).join('');

    // Click to chart
    list.querySelectorAll('.watchlist-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.watchlist-remove')) return;
        this._selectStockForChart(item.dataset.symbol);
      });
    });

    // Remove buttons
    list.querySelectorAll('.watchlist-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.portfolio.removeFromWatchlist(btn.dataset.id);
        this.renderWatchlist();
        this.showToast('Removed from watchlist', 'info');
      });
    });
  }

  _selectStockForChart(symbol) {
    this.selectedStock = symbol;
    const nameEl = document.getElementById('chartStockName');
    const priceEl = document.getElementById('chartStockPrice');
    const chartEmpty = document.getElementById('chartEmpty');
    const chartContainer = document.querySelector('.chart-container');

    // Find stock data
    const holding = this.portfolio.holdings.find(h => h.symbol === symbol);
    const watchItem = this.portfolio.watchlist.find(w => w.symbol === symbol);
    const item = holding || watchItem;

    if (nameEl) nameEl.textContent = item ? `${symbol} — ${item.name || ''}` : symbol;
    if (priceEl && item && item.ltp) {
      const changeClass = (item.changePercent || 0) >= 0 ? 'positive' : 'negative';
      priceEl.innerHTML = `${formatCurrency(item.ltp)} <span class="${changeClass}">${formatPercent(item.changePercent || 0)}</span>`;
    }

    if (chartEmpty) chartEmpty.style.display = 'none';
    if (chartContainer) chartContainer.style.display = 'block';

    this.chartManager.updatePriceChart(symbol, this.selectedPeriod);
  }

  openAddStockModal(editId = null, prefillSymbol = null, prefillName = null) {
    const modal = document.getElementById('stockModal');
    const title = document.getElementById('stockModalTitle');
    const form = document.getElementById('stockForm');
    const editIdInput = document.getElementById('editStockId');
    const searchInput = document.getElementById('stockSearch');
    const symbolInput = document.getElementById('stockSymbol');
    const nameInput = document.getElementById('stockName');

    if (!modal || !form) return;

    form.reset();
    if (editIdInput) editIdInput.value = '';

    if (editId) {
      const holding = this.portfolio.holdings.find(h => h.id === editId);
      if (!holding) return;
      if (title) title.textContent = 'Edit Stock';
      if (editIdInput) editIdInput.value = editId;
      if (searchInput) { searchInput.value = holding.symbol; searchInput.readOnly = true; }
      if (symbolInput) symbolInput.value = holding.symbol;
      if (nameInput) nameInput.value = holding.name || '';
      document.getElementById('stockQty').value = holding.quantity;
      document.getElementById('stockAvgPrice').value = holding.avgPrice;
      if (holding.buyDate) document.getElementById('stockBuyDate').value = holding.buyDate;
      document.getElementById('stockSector').value = holding.sector || 'Other';
    } else {
      if (title) title.textContent = 'Add Stock';
      if (prefillSymbol) {
        if (searchInput) { searchInput.value = prefillSymbol; searchInput.readOnly = true; }
        if (symbolInput) symbolInput.value = prefillSymbol;
        if (nameInput) nameInput.value = prefillName || '';
      } else {
        if (searchInput) searchInput.readOnly = false;
      }
    }

    modal.hidden = false;
    if (searchInput && !editId && !prefillSymbol) searchInput.focus();
  }

  openWatchlistModal() {
    const modal = document.getElementById('watchlistModal');
    const form = document.getElementById('watchlistForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('watchlistSymbol').value = '';
    document.getElementById('watchlistName').value = '';
    modal.hidden = false;
    document.getElementById('watchlistSearch').focus();
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.hidden = true;
    // Clear search results
    document.getElementById('searchResults')?.setAttribute('hidden', '');
    document.getElementById('watchlistSearchResults')?.setAttribute('hidden', '');
  }

  closeAllModals() {
    this.closeModal('stockModal');
    this.closeModal('watchlistModal');
  }

  showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ─── AI Advisor Tab Functionality ───────────────────────────────────────────
  async loadAdvisorData() {
    if (this.isAdvisorLoading) return;
    this.isAdvisorLoading = true;

    const holdingsLoading = document.getElementById('advisorHoldingsLoading');
    const screenerLoading = document.getElementById('advisorScreenerLoading');
    const holdingsList = document.getElementById('advisorHoldingsList');
    const screenerList = document.getElementById('screenerList');

    if (holdingsLoading) holdingsLoading.style.display = 'flex';
    if (screenerLoading) screenerLoading.style.display = 'flex';
    if (holdingsList) holdingsList.innerHTML = '';
    if (screenerList) screenerList.innerHTML = '';

    try {
      const holdingsSymbols = this.portfolio.holdings.map(h => h.symbol);
      const screenerSymbols = ['NIFTYBEES', 'MAFANG', 'GOLDBEES', 'MON100', 'HDFCBANK', 'RELIANCE'];
      
      const allSymbols = [...new Set([...holdingsSymbols, ...screenerSymbols])];

      if (allSymbols.length === 0) {
        this.isAdvisorLoading = false;
        if (holdingsLoading) holdingsLoading.style.display = 'none';
        if (screenerLoading) screenerLoading.style.display = 'none';
        return;
      }

      const analysisResults = await API.getAdvisorAnalysis(allSymbols);
      
      const analysisMap = {};
      if (Array.isArray(analysisResults)) {
        for (const item of analysisResults) {
          if (item && item.symbol) {
            const cleanSym = item.symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
            analysisMap[cleanSym] = item;
            analysisMap[item.symbol.toUpperCase()] = item;
          }
        }
      }

      this.renderAdvisorHoldings(this.portfolio.holdings, analysisMap);
      this.renderAdvisorScreener(screenerSymbols, analysisMap);
      this.renderAdvisorCoach(this.portfolio.holdings, analysisMap);

      // Load news sentiment in parallel
      this.loadNewsSentiment(false).catch(err => console.error('Sentiment loading failed:', err));

    } catch (err) {
      console.error('Advisor loading failed:', err);
      this.showToast('Failed to analyze indicators. Retrying...', 'error');
    } finally {
      this.isAdvisorLoading = false;
      if (holdingsLoading) holdingsLoading.style.display = 'none';
      if (screenerLoading) screenerLoading.style.display = 'none';
    }
  }

  async loadNewsSentiment(refresh = false) {
    const syncBtn = document.getElementById('refreshSentimentBtn');
    const timestampEl = document.getElementById('sentimentTimestamp');

    if (this.isSentimentLoading) return;
    this.isSentimentLoading = true;

    if (syncBtn) {
      syncBtn.classList.add('loading');
      syncBtn.style.animation = 'spin 0.8s linear infinite';
    }

    if (timestampEl) {
      timestampEl.textContent = refresh ? 'Scraping and analyzing daily papers...' : 'Loading sentiment cache...';
    }

    if (refresh) {
      this.showToast('Triggering real-time scraping & sentiment scan across 5 core sectors...', 'info');
    }

    try {
      const data = await API.getNewsSentiment(refresh);
      this.renderNewsSentiment(data);
    } catch (err) {
      console.error('News sentiment load failed:', err);
      this.showToast('Could not fetch latest newspaper predictions.', 'error');
      if (timestampEl) {
        timestampEl.textContent = 'Sync failed. Try manually refreshing.';
      }
    } finally {
      this.isSentimentLoading = false;
      if (syncBtn) {
        syncBtn.classList.remove('loading');
        syncBtn.style.animation = '';
      }
    }
  }

  renderNewsSentiment(data) {
    if (!data) return;

    // 1. Overall Score & Label
    const scoreNumEl = document.getElementById('sentimentScoreNumber');
    const scoreCircleEl = document.getElementById('sentimentScoreCircle');
    const directionBadge = document.getElementById('sentimentDirectionBadge');
    const commentaryEl = document.getElementById('sentimentCommentary');
    const timestampEl = document.getElementById('sentimentTimestamp');

    const score = typeof data.overall_sentiment === 'number' ? data.overall_sentiment : 50;
    const outlook = data.outlook || 'NEUTRAL';
    
    let label = 'NEUTRAL';
    let labelClass = 'neutral';
    if (outlook.toUpperCase().includes('BULLISH')) {
      label = 'BULLISH';
      labelClass = 'bullish';
    } else if (outlook.toUpperCase().includes('BEARISH')) {
      label = 'BEARISH';
      labelClass = 'bearish';
    } else if (outlook.toUpperCase().includes('NEUTRAL')) {
      label = 'NEUTRAL';
      labelClass = 'neutral';
    } else {
      if (score >= 60) { label = 'BULLISH'; labelClass = 'bullish'; }
      else if (score <= 40) { label = 'BEARISH'; labelClass = 'bearish'; }
      else { label = 'NEUTRAL'; labelClass = 'neutral'; }
    }

    const commentary = data.commentary || 'Market sentiment is balanced.';

    if (scoreNumEl) scoreNumEl.textContent = Math.round(score);

    if (scoreCircleEl) {
      scoreCircleEl.className = 'sentiment-score-circle'; // Reset
      scoreCircleEl.classList.add(labelClass);
    }

    if (directionBadge) {
      directionBadge.textContent = outlook;
      directionBadge.className = 'direction-badge'; // Reset
      directionBadge.classList.add(labelClass);
    }

    if (commentaryEl) commentaryEl.textContent = commentary;

    if (timestampEl && data.timestamp) {
      timestampEl.textContent = `As of: ${data.timestamp}`;
    }

    // 2. Sectoral Sentiment Breakdowns
    const sectors = ['global_impact', 'politics_finance', 'general_nse', 'tech_ai', 'pharma', 'growth_startups', 'momentum_picks', 'penny_multibagger'];
    sectors.forEach(sec => {
      const scoreEl = document.getElementById(`score_${sec}`);
      const fillEl = document.getElementById(`fill_${sec}`);

      if (data.sector_scores && typeof data.sector_scores[sec] !== 'undefined') {
        const secScore = Math.round(data.sector_scores[sec]);
        if (scoreEl) scoreEl.textContent = secScore;
        if (fillEl) {
          fillEl.style.width = `${secScore}%`;
          fillEl.className = 'sector-progress-fill'; // Reset
          if (secScore >= 60) fillEl.classList.add('bullish');
          else if (secScore <= 40) fillEl.classList.add('bearish');
          else fillEl.classList.add('neutral');
        }
      }
    });

    // 3. Actionable Trades
    const recsListEl = document.getElementById('geopoliticalRecsList');
    if (recsListEl) {
      if (!data.recommendations || data.recommendations.length === 0) {
        recsListEl.innerHTML = `
          <div class="empty-state visible" style="padding: 16px 0;">
            <p style="font-size: 0.78rem; color: var(--text-muted);">No sector breakouts scanned today.</p>
          </div>
        `;
      } else {
        recsListEl.innerHTML = data.recommendations.map(rec => {
          const assetStr = rec.asset || '';
          let cleanSymbol = assetStr;
          const match = assetStr.match(/\(([^)]+)\)/);
          if (match) {
            cleanSymbol = match[1].split('/')[0].trim().replace('.NS', '').toUpperCase();
          }
          const assetName = assetStr.split('(')[0].trim();

          let recAction = 'HOLD';
          let actionClass = 'hold';
          const recStr = (rec.recommendation || 'HOLD').toUpperCase();
          if (recStr.includes('BUY') || recStr.includes('ACCUMULATE')) {
            recAction = 'BUY';
            actionClass = 'buy';
          } else if (recStr.includes('SELL')) {
            recAction = 'SELL';
            actionClass = 'sell';
          } else {
            recAction = 'HOLD';
            actionClass = 'hold';
          }

          const scoreVal = typeof rec.score === 'number' ? rec.score : 50;
          const scoreClass = scoreVal >= 60 ? 'bullish' : (scoreVal <= 40 ? 'bearish' : 'neutral');

          return `
            <div class="rec-card">
              <div class="rec-header">
                <div class="rec-asset-info">
                  <span class="rec-ticker">${cleanSymbol}</span>
                  <span class="rec-name" title="${assetStr}">${assetName}</span>
                </div>
                <span class="rec-action-badge ${actionClass}">${recAction}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                <span style="font-size: 0.72rem; color: var(--text-muted);">Scanned Sentiment Score:</span>
                <span class="rec-sentiment-score ${scoreClass}">${Math.round(scoreVal)}/100</span>
              </div>
              <p class="rec-reasoning">${rec.guidance || ''}</p>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Geopolitical & Financial Headlines Feed
    const newsListEl = document.getElementById('sentimentNewsList');
    if (newsListEl) {
      if (!data.headlines || data.headlines.length === 0) {
        newsListEl.innerHTML = `
          <div class="empty-state visible" style="padding: 16px 0;">
            <p style="font-size: 0.78rem; color: var(--text-muted);">No relevant geopolitical updates scanned.</p>
          </div>
        `;
      } else {
        newsListEl.innerHTML = data.headlines.map(hl => {
          const sectorRaw = hl.sector || 'General';
          const sectorLower = sectorRaw.toLowerCase().replace(' ', '_');

          const sectorMap = {
            'global_impact': 'Global Impact',
            'politics_finance': 'Politics & Reforms',
            'general_nse': 'Industrial & GDP',
            'tech_ai': 'Tech & AI',
            'pharma': 'Pharma Sector',
            'growth_startups': 'Growth Startups',
            'momentum_picks': 'Short & Mid-Term',
            'penny_multibagger': '🚀 Penny Multibagger'
          };
          const displaySector = sectorMap[sectorLower] || sectorRaw;

          return `
            <div class="news-item-compact">
              <div class="news-meta">
                <span class="news-source">${hl.source || 'Newspaper'}</span>
                <span class="news-time">${hl.date || 'Today'}</span>
              </div>
              <a href="${hl.link || '#'}" target="_blank" rel="noopener noreferrer" class="news-title" style="text-decoration: none; display: block;" title="${hl.title}">
                ${hl.title}
              </a>
              <div class="news-tags">
                <span class="news-tag">${displaySector}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  renderAdvisorHoldings(holdings, analysisMap) {
    const listEl = document.getElementById('advisorHoldingsList');
    if (!listEl) return;

    if (holdings.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state visible">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="opacity:0.4">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M12 8v8M8 12h8"/>
          </svg>
          <h3>No holdings to analyze</h3>
          <p>Add broad index ETFs or stocks to your portfolio to activate the live AI analyst.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = holdings.map(h => {
      const cleanSymbol = h.symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
      const analysis = analysisMap[cleanSymbol] || analysisMap[h.symbol.toUpperCase()];

      if (!analysis) {
        return `
          <div class="advisor-card">
            <div class="advisor-card-header">
              <div class="symbol-info">
                <h3>${h.symbol}</h3>
                <span>${h.name || ''}</span>
              </div>
              <span class="signal-badge hold">ANALYZING</span>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);">Running deep technical analysis on historical daily intervals...</p>
          </div>
        `;
      }

      if (analysis.error) {
        return `
          <div class="advisor-card">
            <div class="advisor-card-header">
              <div class="symbol-info">
                <h3>${h.symbol}</h3>
                <span>${h.name || ''}</span>
              </div>
              <span class="signal-badge sell">ERROR</span>
            </div>
            <p style="font-size:0.75rem;color:var(--negative);">${analysis.error}</p>
          </div>
        `;
      }

      const rec = analysis.recommendation || 'HOLD';
      let glowClass = 'hold-glow';
      let signalBadgeClass = 'hold';
      if (rec === 'STRONG BUY') { glowClass = 'strong-buy-glow'; signalBadgeClass = 'strong-buy'; }
      else if (rec === 'BUY') { glowClass = 'buy-glow'; signalBadgeClass = 'buy'; }
      else if (rec === 'SELL') { glowClass = 'sell-glow'; signalBadgeClass = 'sell'; }
      else if (rec === 'STRONG SELL') { glowClass = 'strong-sell-glow'; signalBadgeClass = 'strong-sell'; }

      const rsiVal = analysis.rsi || 50;
      let rsiClass = '';
      if (rsiVal < 38) rsiClass = 'oversold';
      else if (rsiVal > 62) rsiClass = 'overbought';

      const reasonsText = analysis.reasons ? analysis.reasons.join(' ') : 'Market indicators are showing a steady consolidated neutral trend.';
      const scoreStr = analysis.score >= 0 ? `+${analysis.score}` : `${analysis.score}`;
      
      const emaBullish = analysis.ema9 > analysis.ema21;

      return `
        <div class="advisor-card ${glowClass}" data-symbol="${h.symbol}">
          <div class="advisor-card-header">
            <div class="symbol-info">
              <h3>${h.symbol}</h3>
              <span>${h.name || analysis.shortName || ''}</span>
            </div>
            <span class="signal-badge ${signalBadgeClass}">${rec}</span>
          </div>

          <div class="technical-metrics">
            <div class="metric-box">
              <div class="metric-label">LTP (Daily)</div>
              <div class="metric-value">${formatCurrency(analysis.price)}</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Score Strength</div>
              <div class="metric-value ${analysis.score > 0 ? 'bullish' : (analysis.score < 0 ? 'bearish' : '')}">${scoreStr}</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">EMA alignment</div>
              <div class="metric-value ${emaBullish ? 'bullish' : 'bearish'}">${emaBullish ? 'BULLISH' : 'BEARISH'}</div>
            </div>
          </div>

          <div class="rsi-gauge-wrapper">
            <div class="rsi-gauge-header">
              <span>Momentum Indicator</span>
              <strong>RSI (14): ${rsiVal.toFixed(1)}</strong>
            </div>
            <div class="rsi-gauge-bar">
              <div class="rsi-gauge-fill ${rsiClass}" style="width: ${rsiVal}%"></div>
              <div class="rsi-marker" style="left: ${rsiVal}%"></div>
            </div>
            <div class="rsi-zones">
              <span>Oversold (<35)</span>
              <span>Neutral</span>
              <span>Overbought (>65)</span>
            </div>
          </div>

          <p class="advisor-commentary ${signalBadgeClass}">
            ${reasonsText}
          </p>

          <div class="advisor-actions">
            <button class="advisor-btn btn-watch" data-symbol="${h.symbol}" data-action="chart">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
              View Chart
            </button>
            ${rec.includes('BUY') ? `
              <button class="advisor-btn btn-buy" data-symbol="${h.symbol}" data-name="${h.name || analysis.shortName}" data-action="buy">
                + Buy More
              </button>
            ` : `
              <button class="advisor-btn btn-sell" data-id="${h.id}" data-action="edit">
                Manage Holding
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.advisor-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const symbol = btn.dataset.symbol;
        const id = btn.dataset.id;
        const name = btn.dataset.name;

        if (action === 'chart') {
          document.getElementById('tabDashboard').click();
          this._selectStockForChart(symbol);
        } else if (action === 'buy') {
          this.openAddStockModal(null, symbol, name);
        } else if (action === 'edit') {
          this.openAddStockModal(id);
        }
      });
    });
  }

  renderAdvisorScreener(screenerSymbols, analysisMap) {
    const listEl = document.getElementById('screenerList');
    if (!listEl) return;

    const opportunities = [];
    for (const sym of screenerSymbols) {
      const cleanSymbol = sym.replace('.NS', '').replace('.BO', '').toUpperCase();
      const analysis = analysisMap[cleanSymbol] || analysisMap[sym.toUpperCase()];
      if (analysis && !analysis.error) {
        opportunities.push(analysis);
      }
    }

    if (opportunities.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state visible">
          <p>No screening data available. Please verify backend state.</p>
        </div>
      `;
      return;
    }

    opportunities.sort((a, b) => b.score - a.score);

    listEl.innerHTML = opportunities.map(opp => {
      const rec = opp.recommendation || 'HOLD';
      let glowClass = 'hold-glow';
      let signalBadgeClass = 'hold';
      if (rec === 'STRONG BUY') { glowClass = 'strong-buy-glow'; signalBadgeClass = 'strong-buy'; }
      else if (rec === 'BUY') { glowClass = 'buy-glow'; signalBadgeClass = 'buy'; }
      else if (rec === 'SELL') { glowClass = 'sell-glow'; signalBadgeClass = 'sell'; }
      else if (rec === 'STRONG SELL') { glowClass = 'strong-sell-glow'; signalBadgeClass = 'strong-sell'; }

      const cleanSymbol = opp.symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
      const inWatchlist = this.portfolio.watchlist.some(w => w.symbol.replace('.NS','').replace('.BO','').toUpperCase() === cleanSymbol);
      const inHoldings = this.portfolio.holdings.some(h => h.symbol.replace('.NS','').replace('.BO','').toUpperCase() === cleanSymbol);

      const trendText = opp.ema9 > opp.ema21 ? 'Uptrend' : 'Downtrend';
      const trendClass = opp.ema9 > opp.ema21 ? 'bullish' : 'bearish';

      return `
        <div class="advisor-card ${glowClass}" data-symbol="${cleanSymbol}">
          <div class="advisor-card-header">
            <div class="symbol-info">
              <h3>${cleanSymbol}</h3>
              <span>${opp.shortName || ''}</span>
            </div>
            <span class="signal-badge ${signalBadgeClass}">${rec}</span>
          </div>

          <div class="technical-metrics">
            <div class="metric-box">
              <div class="metric-label">LTP</div>
              <div class="metric-value">${formatCurrency(opp.price)}</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">RSI (14)</div>
              <div class="metric-value">${opp.rsi.toFixed(1)}</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">EMA Trend</div>
              <div class="metric-value ${trendClass}">${trendText}</div>
            </div>
          </div>

          <div class="advisor-actions">
            ${inWatchlist ? `
              <button class="advisor-btn btn-watch" disabled style="opacity:0.6; cursor:default;">
                ✓ Watchlist
              </button>
            ` : `
              <button class="advisor-btn btn-watch" data-symbol="${cleanSymbol}" data-name="${opp.shortName}" data-action="watch">
                + Watchlist
              </button>
            `}

            ${inHoldings ? `
              <button class="advisor-btn btn-buy" data-symbol="${cleanSymbol}" data-name="${opp.shortName}" data-action="buy">
                + Buy More
              </button>
            ` : `
              <button class="advisor-btn btn-buy" data-symbol="${cleanSymbol}" data-name="${opp.shortName}" data-action="buy-new" style="background:rgba(139, 92, 246, 0.08); border-color:rgba(139, 92, 246, 0.2); color:var(--accent-purple);">
                + Portfolio
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.advisor-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const symbol = btn.dataset.symbol;
        const name = btn.dataset.name;

        if (action === 'watch') {
          this.portfolio.addToWatchlist({ symbol, name });
          this.renderWatchlist();
          this.showToast(`${symbol} added to Watchlist!`, 'success');
          this.renderAdvisorScreener(screenerSymbols, analysisMap);
        } else if (action === 'buy' || action === 'buy-new') {
          this.openAddStockModal(null, symbol, name);
        }
      });
    });
  }

  renderAdvisorCoach(holdings, analysisMap) {
    const rebalanceAdviceEl = document.getElementById('rebalanceAdvice');
    const profitAdviceEl = document.getElementById('profitAdvice');

    if (!rebalanceAdviceEl || !profitAdviceEl) return;

    if (holdings.length === 0) {
      rebalanceAdviceEl.innerHTML = "Add some index ETFs to your holdings first. Your Portfolio Coach will analyze your allocations and guide you to safe, optimized returns.";
    } else {
      let totalValue = 0;
      const values = {};
      
      for (const h of holdings) {
        const cleanSymbol = h.symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
        const analysis = analysisMap[cleanSymbol] || analysisMap[h.symbol.toUpperCase()];
        const ltp = analysis ? analysis.price : h.avgPrice;
        const val = ltp * h.quantity;
        totalValue += val;
        values[cleanSymbol] = val;
      }

      const pharmaVal = values['PHARMABEES'] || 0;
      const nextVal = values['NEXT50IETF'] || 0;
      
      const pharmaPct = totalValue > 0 ? (pharmaVal / totalValue * 100) : 0;
      const nextPct = totalValue > 0 ? (nextVal / totalValue * 100) : 0;

      if (pharmaPct > 65) {
        rebalanceAdviceEl.innerHTML = `Your portfolio is heavily overweight in **PHARMABEES** (actual allocation **${pharmaPct.toFixed(1)}%** vs safe target 40%). High sectoral concentration increases risk. We recommend directing future additions (~₹100/week) into the core **NEXT50IETF** or **NIFTYBEES** to systematically rebalance and reduce sector-specific volatility.`;
      } else if (nextPct > 70) {
        rebalanceAdviceEl.innerHTML = `Your portfolio is heavily allocated in **NEXT50IETF** (**${nextPct.toFixed(1)}%**). While core index ETFs are safe, you have a very small exposure in pharma. You could consider dedicating a small SIP amount to **PHARMABEES** if technical momentum indicates a bullish entry point.`;
      } else {
        rebalanceAdviceEl.innerHTML = `Your current asset allocation is well-balanced (**PHARMABEES** at **${pharmaPct.toFixed(1)}%** vs **NEXT50IETF** at **${nextPct.toFixed(1)}%**). This distribution provides a solid foundation of broad-market index stability and growth-heavy thematic health sector exposure. Continue regular investing!`;
      }
    }

    let profitAdvice = "";
    const overboughtHoldings = [];

    for (const h of holdings) {
      const cleanSymbol = h.symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
      const analysis = analysisMap[cleanSymbol] || analysisMap[h.symbol.toUpperCase()];
      if (analysis && (analysis.rsi > 62 || analysis.recommendation.includes('SELL'))) {
        overboughtHoldings.push({ symbol: cleanSymbol, rsi: analysis.rsi, rec: analysis.recommendation });
      }
    }

    if (overboughtHoldings.length > 0) {
      const items = overboughtHoldings.map(h => `**${h.symbol}** (RSI: **${h.rsi.toFixed(1)}** — ${h.rec})`).join(', ');
      profitAdvice = `Algorithmic Alert: ${items} is currently trading in elevated overbought territory. Since transaction friction is high on small portfolios, do NOT sell everything. Instead, consider selling **1 or 2 units** to secure partial returns, booking absolute gains, and reinvesting when prices cross into the oversold zone (<38).`;
    } else {
      profitAdvice = `All your active holdings (**PHARMABEES** and **NEXT50IETF**) are trading within healthy neutral/oversold support levels. There is absolutely no technical reason to sell right now. Let your units compound, and strictly protect your gains against brokerage erosion.`;
    }

    profitAdviceEl.innerHTML = profitAdvice;
  }

  renderAll() {
    this.renderSummaryCards();
    this.renderHoldingsTable();
    this.renderWatchlist();
    this.chartManager.updateAllocationChart(this.portfolio.holdings);
  }
}

// ─── Search Autocomplete ──────────────────────────────────────────────────────
function setupSearchAutocomplete(inputEl, resultsEl, onSelect) {
  const doSearch = debounce(async (query) => {
    if (!query || query.length < 2) {
      resultsEl.hidden = true;
      return;
    }

    resultsEl.innerHTML = '<div class="search-loading">Searching...</div>';
    resultsEl.hidden = false;

    try {
      const results = await API.searchStocks(query);
      if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-no-results">No Indian stocks found</div>';
        return;
      }

      resultsEl.innerHTML = results.slice(0, 8).map(r => {
        const cleanSymbol = r.symbol.replace('.NS', '').replace('.BO', '');
        const exchange = r.symbol.endsWith('.BO') ? 'BSE' : 'NSE';
        return `
          <div class="search-result-item" data-symbol="${cleanSymbol}" data-name="${r.shortname || r.longname || ''}" data-exchange="${exchange}">
            <div>
              <div class="search-result-symbol">${cleanSymbol}</div>
              <div class="search-result-name">${r.shortname || r.longname || ''}</div>
            </div>
            <span class="search-result-exchange">${exchange}</span>
          </div>
        `;
      }).join('');

      resultsEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          onSelect(item.dataset.symbol, item.dataset.name);
          resultsEl.hidden = true;
        });
      });
    } catch (err) {
      resultsEl.innerHTML = '<div class="search-no-results">Search failed. Try again.</div>';
    }
  }, 300);

  inputEl.addEventListener('input', (e) => doSearch(e.target.value.trim()));
  inputEl.addEventListener('focus', (e) => {
    if (e.target.value.length >= 2) doSearch(e.target.value.trim());
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.hidden = true;
    }
  });
}

// ─── Price Updater ────────────────────────────────────────────────────────────
class PriceUpdater {
  constructor(portfolio, ui, chartManager) {
    this.portfolio = portfolio;
    this.ui = ui;
    this.chartManager = chartManager;
    this.intervalId = null;
    this.isUpdating = false;
  }

  async updateAllPrices() {
    if (this.isUpdating) return;
    this.isUpdating = true;

    try {
      // Collect all unique symbols
      const holdingSymbols = this.portfolio.holdings.map(h => h.symbol);
      const watchlistSymbols = this.portfolio.watchlist.map(w => w.symbol);
      const allSymbols = [...new Set([...holdingSymbols, ...watchlistSymbols])];

      if (allSymbols.length === 0) {
        this.ui.renderAll();
        this.isUpdating = false;
        return;
      }

      const quotes = await API.getQuotes(allSymbols);

      // Map quotes by symbol (strip .NS/.BO)
      const quoteMap = {};
      for (const q of quotes) {
        const cleanSymbol = q.symbol.replace('.NS', '').replace('.BO', '');
        quoteMap[cleanSymbol] = q;
      }

      // Update holdings with live data
      for (const h of this.portfolio.holdings) {
        const q = quoteMap[h.symbol];
        if (q) {
          h.ltp = q.regularMarketPrice || 0;
          h.change = q.regularMarketChange || 0;
          h.changePercent = q.regularMarketChangePercent || 0;
          h.dayHigh = q.regularMarketDayHigh || 0;
          h.dayLow = q.regularMarketDayLow || 0;
          h.weekHigh52 = q.fiftyTwoWeekHigh || 0;
          h.weekLow52 = q.fiftyTwoWeekLow || 0;
          h.marketCap = q.marketCap || 0;
        }
      }

      // Update watchlist
      for (const w of this.portfolio.watchlist) {
        const q = quoteMap[w.symbol];
        if (q) {
          w.ltp = q.regularMarketPrice || 0;
          w.change = q.regularMarketChange || 0;
          w.changePercent = q.regularMarketChangePercent || 0;
        }
      }

      // Re-render
      this.ui.renderAll();

      // Flash LTP cells
      document.querySelectorAll('.ltp-cell').forEach(cell => {
        cell.classList.add('price-flash');
        setTimeout(() => cell.classList.remove('price-flash'), 800);
      });

      // Update timestamp
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const updatedEl = document.getElementById('lastUpdated');
      if (updatedEl) updatedEl.textContent = `Last updated: ${timeStr}`;

    } catch (err) {
      console.error('Price update error:', err);
      this.ui.showToast('Failed to update prices. Will retry...', 'error');
    }

    this.isUpdating = false;
  }

  async startAutoRefresh() {
    // Initial update
    await this.updateAllPrices();

    // Update market status
    await this._updateMarketStatus();

    // Set interval (30 seconds)
    this.intervalId = setInterval(() => {
      this.updateAllPrices();
    }, 30000);

    // Update market status every minute
    setInterval(() => this._updateMarketStatus(), 60000);
  }

  async _updateMarketStatus() {
    try {
      const status = await API.getMarketStatus();
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');

      if (dot) {
        dot.classList.toggle('open', status.isOpen);
        dot.classList.toggle('closed', !status.isOpen);
      }
      if (text) {
        text.textContent = status.isOpen ? 'NSE Open' : 'NSE Closed';
      }
    } catch {
      // Silent fail for market status
    }
  }

  stopAutoRefresh() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// ─── App Initialization ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const portfolio = new PortfolioManager();
  const chartManager = new ChartManager();
  const ui = new UIController(portfolio, chartManager);
  const updater = new PriceUpdater(portfolio, ui, chartManager);

  // Initialize charts
  chartManager.initPriceChart('priceChart');
  chartManager.initAllocationChart('allocationChart');

  // Initial render
  ui.renderAll();

  // Hide chart initially, show empty
  const chartContainer = document.querySelector('.chart-container');
  const chartEmpty = document.getElementById('chartEmpty');
  if (chartContainer) chartContainer.style.display = 'none';
  if (chartEmpty) chartEmpty.style.display = 'flex';

  // Start auto-refresh
  updater.startAutoRefresh();

  // ── Tab Switching ──
  const tabDashboard = document.getElementById('tabDashboard');
  const tabAdvisor = document.getElementById('tabAdvisor');
  const mainContent = document.getElementById('mainContent');
  const advisorContent = document.getElementById('advisorContent');
  const chartSection = document.getElementById('chartSection');

  tabDashboard?.addEventListener('click', () => {
    tabDashboard.classList.add('active');
    tabDashboard.setAttribute('aria-selected', 'true');
    tabAdvisor?.classList.remove('active');
    tabAdvisor?.setAttribute('aria-selected', 'false');

    if (mainContent) mainContent.style.display = 'grid';
    if (advisorContent) advisorContent.style.display = 'none';
    if (chartSection) chartSection.style.display = 'block';
  });

  tabAdvisor?.addEventListener('click', () => {
    tabAdvisor.classList.add('active');
    tabAdvisor.setAttribute('aria-selected', 'true');
    tabDashboard?.classList.remove('active');
    tabDashboard?.setAttribute('aria-selected', 'false');

    if (mainContent) mainContent.style.display = 'none';
    if (advisorContent) advisorContent.style.display = 'grid';
    if (chartSection) chartSection.style.display = 'none';

    // Load advisor data when tab becomes active
    ui.loadAdvisorData();
  });

  // Refresh Advisor button
  document.getElementById('refreshAdvisorBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('refreshAdvisorBtn');
    if (btn) {
      btn.style.animation = 'spin 0.8s linear';
      setTimeout(() => btn.style.animation = '', 800);
    }
    ui.loadAdvisorData();
    ui.showToast('Recalculating technical analysis indicators...', 'info');
  });

  // Refresh Sentiment button
  document.getElementById('refreshSentimentBtn')?.addEventListener('click', () => {
    ui.loadNewsSentiment(true);
  });

  // ── Event Listeners ──

  // Add Stock buttons
  document.getElementById('addStockBtn')?.addEventListener('click', () => ui.openAddStockModal());
  document.getElementById('emptyAddBtn')?.addEventListener('click', () => ui.openAddStockModal());

  // Add Watchlist button
  document.getElementById('addWatchlistBtn')?.addEventListener('click', () => ui.openWatchlistModal());

  // Stock modal close
  document.getElementById('stockModalClose')?.addEventListener('click', () => ui.closeModal('stockModal'));
  document.getElementById('stockModalCancel')?.addEventListener('click', () => ui.closeModal('stockModal'));
  document.getElementById('stockModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'stockModal') ui.closeModal('stockModal');
  });

  // Watchlist modal close
  document.getElementById('watchlistModalClose')?.addEventListener('click', () => ui.closeModal('watchlistModal'));
  document.getElementById('watchlistModalCancel')?.addEventListener('click', () => ui.closeModal('watchlistModal'));
  document.getElementById('watchlistModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'watchlistModal') ui.closeModal('watchlistModal');
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ui.closeAllModals();
  });

  // Stock search autocomplete
  const stockSearchInput = document.getElementById('stockSearch');
  const stockSearchResults = document.getElementById('searchResults');
  if (stockSearchInput && stockSearchResults) {
    setupSearchAutocomplete(stockSearchInput, stockSearchResults, (symbol, name) => {
      stockSearchInput.value = symbol;
      document.getElementById('stockSymbol').value = symbol;
      document.getElementById('stockName').value = name;
    });
  }

  // Watchlist search autocomplete
  const watchSearchInput = document.getElementById('watchlistSearch');
  const watchSearchResults = document.getElementById('watchlistSearchResults');
  if (watchSearchInput && watchSearchResults) {
    setupSearchAutocomplete(watchSearchInput, watchSearchResults, (symbol, name) => {
      watchSearchInput.value = `${symbol} — ${name}`;
      document.getElementById('watchlistSymbol').value = symbol;
      document.getElementById('watchlistName').value = name;
    });
  }

  // Stock form submit
  document.getElementById('stockForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const editId = document.getElementById('editStockId').value;
    const symbol = document.getElementById('stockSymbol').value.trim().toUpperCase();
    const name = document.getElementById('stockName').value.trim();
    const quantity = parseInt(document.getElementById('stockQty').value, 10);
    const avgPrice = parseFloat(document.getElementById('stockAvgPrice').value);
    const buyDate = document.getElementById('stockBuyDate').value || null;
    const sector = document.getElementById('stockSector').value;

    if (!symbol || !quantity || !avgPrice) {
      ui.showToast('Please fill in all required fields', 'error');
      return;
    }

    if (editId) {
      portfolio.updateHolding(editId, { symbol, name, quantity, avgPrice, buyDate, sector });
      ui.showToast(`${symbol} updated successfully`, 'success');
    } else {
      // Check for duplicate
      if (portfolio.holdings.some(h => h.symbol === symbol)) {
        ui.showToast(`${symbol} already in portfolio. Use edit instead.`, 'error');
        return;
      }
      portfolio.addHolding({ symbol, name, quantity, avgPrice, buyDate, sector });
      ui.showToast(`${symbol} added to portfolio!`, 'success');
    }

    ui.closeModal('stockModal');
    ui.renderAll();
    updater.updateAllPrices();
  });

  // Watchlist form submit
  document.getElementById('watchlistForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const symbol = document.getElementById('watchlistSymbol').value.trim().toUpperCase();
    const name = document.getElementById('watchlistName').value.trim();
    const targetPrice = parseFloat(document.getElementById('watchlistTargetPrice').value) || null;

    if (!symbol) {
      ui.showToast('Please select a stock', 'error');
      return;
    }

    const result = portfolio.addToWatchlist({ symbol, name, targetPrice });
    if (!result) {
      ui.showToast(`${symbol} is already in your watchlist`, 'error');
      return;
    }

    ui.closeModal('watchlistModal');
    ui.renderWatchlist();
    updater.updateAllPrices();
    ui.showToast(`${symbol} added to watchlist!`, 'success');
  });

  // Sort column headers
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (ui.sortColumn === column) {
        ui.sortDirection = ui.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        ui.sortColumn = column;
        ui.sortDirection = 'asc';
      }

      // Update sort arrow indicators
      document.querySelectorAll('.sortable').forEach(el => {
        el.classList.remove('sorted');
        el.querySelector('.sort-arrow').textContent = '';
      });
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent = ui.sortDirection === 'asc' ? '▲' : '▼';

      ui.renderHoldingsTable();
    });
  });

  // Chart period buttons
  document.getElementById('periodButtons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.period-btn');
    if (!btn) return;

    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    ui.selectedPeriod = btn.dataset.period;
    if (ui.selectedStock) {
      chartManager.updatePriceChart(ui.selectedStock, ui.selectedPeriod);
    }
  });

  // Manual refresh
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.style.animation = 'spin 0.8s linear';
      setTimeout(() => btn.style.animation = '', 800);
    }
    updater.updateAllPrices();
    ui.showToast('Refreshing prices...', 'info');
  });

  // Export
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const json = portfolio.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockpulse_portfolio_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.showToast('Portfolio exported successfully!', 'success');
  });

  // Import
  document.getElementById('importBtn')?.addEventListener('click', () => {
    document.getElementById('importFileInput')?.click();
  });

  document.getElementById('importFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        portfolio.importJSON(ev.target.result);
        ui.renderAll();
        updater.updateAllPrices();
        ui.showToast('Portfolio imported successfully!', 'success');
      } catch (err) {
        ui.showToast('Invalid portfolio file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  });
});
