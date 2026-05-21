import Chart from 'chart.js/auto';

const SECTOR_COLORS = [
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

const CHART_DEFAULTS = {
  fontColor: '#9ca3af',
  gridColor: 'rgba(255, 255, 255, 0.05)',
  tooltipBg: 'rgba(17, 24, 39, 0.95)',
  tooltipBorder: 'rgba(255, 255, 255, 0.1)',
};

export class ChartManager {
  constructor() {
    this.priceChart = null;
    this.allocationChart = null;
    this._configureDefaults();
  }

  _configureDefaults() {
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = CHART_DEFAULTS.fontColor;
    Chart.defaults.plugins.legend.display = false;
  }

  initPriceChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 350);
    gradient.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
    gradient.addColorStop(0.5, 'rgba(6, 182, 212, 0.08)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');

    this.priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Price',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#06b6d4',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CHART_DEFAULTS.tooltipBg,
            borderColor: CHART_DEFAULTS.tooltipBorder,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 13, weight: '500', family: "'SF Mono', 'Fira Code', monospace" },
            displayColors: false,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                return items[0].label;
              },
              label: (item) => {
                return `₹${Number(item.raw).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: CHART_DEFAULTS.gridColor, drawBorder: false },
            ticks: {
              color: CHART_DEFAULTS.fontColor,
              maxTicksLimit: 8,
              font: { size: 10 },
            },
            border: { display: false },
          },
          y: {
            position: 'right',
            grid: { color: CHART_DEFAULTS.gridColor, drawBorder: false },
            ticks: {
              color: CHART_DEFAULTS.fontColor,
              font: { size: 10 },
              callback: (val) => '₹' + Number(val).toLocaleString('en-IN'),
            },
            border: { display: false },
          },
        },
        animation: {
          duration: 600,
          easing: 'easeOutQuart',
        },
      },
    });
  }

  async updatePriceChart(symbol, period = '1mo') {
    if (!this.priceChart) return;

    try {
      const res = await fetch(`/api/history/${symbol}?period=${period}`);
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // Parse yahoo-finance2 chart response
      let quotes = [];
      if (data.quotes && Array.isArray(data.quotes)) {
        quotes = data.quotes;
      } else if (data.indicators?.quote?.[0]) {
        // Alternative format
        const timestamps = data.timestamp || [];
        const closeArr = data.indicators.quote[0].close || [];
        quotes = timestamps.map((ts, i) => ({
          date: new Date(ts * 1000),
          close: closeArr[i],
        }));
      }

      if (quotes.length === 0) return;

      // Format labels based on period
      const labels = quotes.map(q => {
        const d = q.date ? new Date(q.date) : null;
        if (!d || isNaN(d)) return '';
        if (period === '1d' || period === '5d') {
          return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        } else if (period === '1mo' || period === '3mo') {
          return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        } else {
          return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        }
      });

      const prices = quotes.map(q => q.close).filter(v => v != null);
      const filteredLabels = labels.filter((_, i) => quotes[i].close != null);

      // Update gradient with canvas height
      const canvas = this.priceChart.canvas;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 350);

      // Color based on performance
      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      const isPositive = lastPrice >= firstPrice;
      const lineColor = isPositive ? '#10b981' : '#ef4444';

      gradient.addColorStop(0, isPositive ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)');
      gradient.addColorStop(0.5, isPositive ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      this.priceChart.data.labels = filteredLabels;
      this.priceChart.data.datasets[0].data = prices;
      this.priceChart.data.datasets[0].borderColor = lineColor;
      this.priceChart.data.datasets[0].backgroundColor = gradient;
      this.priceChart.data.datasets[0].pointHoverBackgroundColor = lineColor;

      this.priceChart.update('none');
      // Then animate
      this.priceChart.update();

    } catch (err) {
      console.error('Chart update error:', err);
    }
  }

  initAllocationChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    this.allocationChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: SECTOR_COLORS,
          borderColor: 'rgba(10, 14, 26, 0.8)',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: '#9ca3af',
              font: { size: 10, weight: '500' },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: CHART_DEFAULTS.tooltipBg,
            borderColor: CHART_DEFAULTS.tooltipBorder,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 12, weight: '500' },
            callbacks: {
              label: (item) => {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((item.raw / total) * 100).toFixed(1);
                const val = Number(item.raw).toLocaleString('en-IN', {
                  style: 'currency',
                  currency: 'INR',
                  maximumFractionDigits: 0,
                });
                return `${item.label}: ${val} (${pct}%)`;
              },
            },
          },
        },
        animation: {
          animateScale: true,
          animateRotate: true,
          duration: 800,
          easing: 'easeOutQuart',
        },
      },
    });
  }

  updateAllocationChart(holdings) {
    if (!this.allocationChart) return;

    const allocationEmpty = document.getElementById('allocationEmpty');
    const chartContainer = this.allocationChart.canvas.parentElement;

    if (!holdings || holdings.length === 0) {
      if (allocationEmpty) allocationEmpty.style.display = 'flex';
      if (chartContainer) chartContainer.style.display = 'none';
      this.allocationChart.data.labels = [];
      this.allocationChart.data.datasets[0].data = [];
      this.allocationChart.update();
      return;
    }

    if (allocationEmpty) allocationEmpty.style.display = 'none';
    if (chartContainer) chartContainer.style.display = 'block';

    // Group by sector
    const sectorMap = {};
    for (const h of holdings) {
      const sector = h.sector || 'Other';
      const value = (h.ltp || h.avgPrice) * h.quantity;
      sectorMap[sector] = (sectorMap[sector] || 0) + value;
    }

    const sectors = Object.keys(sectorMap);
    const values = sectors.map(s => sectorMap[s]);

    this.allocationChart.data.labels = sectors;
    this.allocationChart.data.datasets[0].data = values;
    this.allocationChart.data.datasets[0].backgroundColor = SECTOR_COLORS.slice(0, sectors.length);
    this.allocationChart.update();
  }

  destroy() {
    if (this.priceChart) {
      this.priceChart.destroy();
      this.priceChart = null;
    }
    if (this.allocationChart) {
      this.allocationChart.destroy();
      this.allocationChart = null;
    }
  }
}
