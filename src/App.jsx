import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Calendar, Users, Target, DollarSign, Send, Plus, X, MessageSquare, Video, Zap } from 'lucide-react';

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz81O5PsFvWYTJ2GNklG30I49fbkmArdks5EUzH0eUSvC8rph_FaUiBrhUzF15ueA3n/exec';
const PAYMENTS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/14sOJxoFt0z3xvjStEt3vHAqJtHg_xudP3qwgBhyf7bM/export?format=csv';
const PAYMENTS_SHEET_LINK = 'https://docs.google.com/spreadsheets/d/14sOJxoFt0z3xvjStEt3vHAqJtHg_xudP3qwgBhyf7bM/edit?usp=sharing';

const MONTH_NAMES_RU = {
  '01':'Январь','02':'Февраль','03':'Март','04':'Апрель',
  '05':'Май','06':'Июнь','07':'Июль','08':'Август',
  '09':'Сентябрь','10':'Октябрь','11':'Ноябрь','12':'Декабрь'
};

// Точные индексы колонок «Оплачено факт» (RUB и USDt) по каждому месяцу
// Определены по структуре таблицы включая скрытые колонки
const SHEET_FACT_COLS = {
  '11': { rub: 16, usdt: 17 }, // Ноябрь
  '12': { rub: 23, usdt: 24 }, // Декабрь
  '01': { rub: 30, usdt: 31 }, // Январь
  '02': { rub: 38, usdt: 39 }, // Февраль
  '03': { rub: 46, usdt: 47 }, // Март
  '04': { rub: 54, usdt: 55 }, // Апрель
  '05': { rub: 61, usdt: 62 }, // Май
};

const parseSimpleCSV = (text) => text.split(/\r?\n/).map(line => {
  const cols = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
});

const parseSheetNum = (val) => {
  if (!val || /^(#|TRUE|FALSE)/i.test(val)) return 0;
  return parseFloat(val.replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
};

const fetchReconciliation = async (month) => {
  const [, monthNum] = (month || '').split('-');
  const monthNameTarget = MONTH_NAMES_RU[monthNum] || '';
  const cols = SHEET_FACT_COLS[monthNum];
  if (!cols) return { error: `Месяц «${monthNameTarget || monthNum}» не поддерживается (нет в таблице)` };
  try {
    const resp = await fetch(PAYMENTS_SHEET_URL, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    const rows = parseSimpleCSV(text);
    if (rows.length < 4) return { error: 'Таблица пустая или недоступна' };

    const clients = [];
    let totalRUB = 0, totalUSDt = 0;
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row[1] || !row[0] || isNaN(parseInt(row[0]))) continue;
      const rub  = parseSheetNum(row[cols.rub]);
      const usdt = parseSheetNum(row[cols.usdt]);
      if (rub > 0 || usdt > 0) {
        clients.push({ name: row[1], rub, usdt });
        totalRUB += rub; totalUSDt += usdt;
      }
    }
    return { clients, totalRUB, totalUSDt, monthName: monthNameTarget };
  } catch (e) {
    return { error: e.message };
  }
};

const sendToGoogleSheets = async (data, type, onComplete) => {
  const reportData = {...data, type, timestamp: new Date().toISOString()};

  // Пробуем сразу отправить на сервер через GET (без CORS)
  // potentialRows сериализуем как JSON-строку для хранения в таблице
  try {
    const { potentials, ...serverData } = reportData;
    if (serverData.potentialRows && Array.isArray(serverData.potentialRows)) {
      serverData.potentialRows = JSON.stringify(serverData.potentialRows.filter(r => r.account || r.profile));
    }
    const encoded = encodeURIComponent(JSON.stringify(serverData));
    const url = `${GOOGLE_SCRIPT_URL}?action=save&data=${encoded}`;
    const response = await fetch(url, { method: 'GET', mode: 'cors' });
    if (response.ok) {
      const result = await response.json();
      if (result.status === 'ok') {
        // Успешно — кладём в локальный кеш (для офлайн аналитики)
        try {
          const cache = JSON.parse(localStorage.getItem('localReportsCache') || '[]');
          cache.push(reportData);
          localStorage.setItem('localReportsCache', JSON.stringify(cache));
        } catch (_) {}
        alert('✅ Отчёт сохранён и синхронизирован!');
        if (typeof onComplete === 'function') onComplete();
        return;
      }
    }
  } catch (e) {
    console.warn('⚠️ Не удалось отправить:', e.message);
  }

  // Не удалось — кладём в очередь на повтор и в локальный кеш
  try {
    const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
    pending.push(reportData);
    localStorage.setItem('pendingReports', JSON.stringify(pending));
    const cache = JSON.parse(localStorage.getItem('localReportsCache') || '[]');
    cache.push(reportData);
    localStorage.setItem('localReportsCache', JSON.stringify(cache));
  } catch (e) {
    console.warn('⚠️ Ошибка localStorage:', e.message);
  }

  alert('✅ Отчёт сохранён локально. Будет синхронизирован при следующем подключении.');
  if (typeof onComplete === 'function') onComplete();
};

const fetchBybitRates = async () => {
  let usdRub = null;
  let source = '';

  // Попытка 1: Bybit P2P (может не работать из-за CORS в некоторых браузерах)
  try {
    const p2pResp = await fetch('https://api2.bybit.com/fiat/otc/item/online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenId: 'USDT', currencyId: 'RUB',
        payment: [], side: '1', size: '20', page: '1', amount: ''
      })
    });
    const p2p = await p2pResp.json();
    const items = p2p?.result?.items;
    if (items?.length) {
      const prices = items.map(i => parseFloat(i.price)).filter(Boolean);
      if (prices.length) {
        usdRub = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
        source = 'Bybit P2P';
      }
    }
  } catch (_) {}

  // Попытка 2: CoinGecko (всегда работает из браузера)
  if (!usdRub) {
    const cgResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub');
    const cg = await cgResp.json();
    usdRub = cg?.tether?.rub;
    if (!usdRub) throw new Error('Не удалось получить курс ни с Bybit P2P, ни с CoinGecko');
    source = 'CoinGecko';
  }

  // EUR/RUB через Bybit spot, иначе CoinGecko
  let eurRub = null;
  try {
    const eurResp = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=EURUSDT');
    const eur = await eurResp.json();
    const eurUsdt = parseFloat(eur?.result?.list?.[0]?.lastPrice);
    if (eurUsdt) eurRub = Math.round(eurUsdt * usdRub * 100) / 100;
  } catch (_) {}
  if (!eurRub) {
    try {
      const cgEurResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub,eur');
      const cgEur = await cgEurResp.json();
      const rubPerUsdt = cgEur?.tether?.rub;
      const eurPerUsdt = cgEur?.tether?.eur;
      if (rubPerUsdt && eurPerUsdt) eurRub = Math.round((rubPerUsdt / eurPerUsdt) * 100) / 100;
    } catch (_) {}
  }

  return { usdRub, eurRub, source };
};

const fetchSheetData = async (params) => {
  try {
    const query = new URLSearchParams(params);
    const url = `${GOOGLE_SCRIPT_URL}?${query.toString()}`;
    console.log('� Запрос к Google Sheets:', url);
    
    // Попытка 1: Обычный fetch с CORS
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error('❌ Ошибка при загрузке данных. Статус:', response.status, response.statusText);
        return [];
      }
      
      const result = await response.json();
      console.log('✅ Данные получены:', result);
      
      if (!Array.isArray(result)) {
        console.warn('⚠️ Данные не являются массивом, получено:', typeof result, result);
        return [];
      }
      
      console.log(`✅ Загружено ${result.length} записей`);
      return result;
    } catch (corsError) {
      console.warn('⚠️ CORS запрос не удалась, пробую no-cors:', corsError.message);
      
      // Попытка 2: no-cors (но не сможем получить JSON)
      try {
        const response = await fetch(url, {
          method: 'GET',
          mode: 'no-cors'
        });
        console.log('✅ Запрос отправлен (no-cors), но данные может быть недоступны');
        return [];
      } catch (e) {
        console.error('❌ Все методы загрузки данных не сработали:', e.message);
        return [];
      }
    }
  } catch (error) {
    console.error('❌ Ошибка при загрузке данных:', error.message);
    return [];
  }
};

const formatDateString = (date) => date.toISOString().split('T')[0];

const saveDraft = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('LocalStorage save failed', error);
  }
};

const loadDraft = (key, defaultValue) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (error) {
    console.warn('LocalStorage load failed', error);
    return defaultValue;
  }
};

const generateZeroData = (days) => {
  const data = [];
  const groupBy = days <= 7 ? 'day' : days <= 90 ? 'week' : 'month';

  if (groupBy === 'day') {
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }),
        revenue: 0,
        leads: 0,
        dialogs: 0,
        intensive: 0,
        zoom: 0,
        conversion: 0
      });
    }
  } else if (groupBy === 'week') {
    const weeks = Math.ceil(days / 7);
    for (let i = weeks - 1; i >= 0; i--) {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - (i * 7));
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);

      const startDay = startDate.getDate();
      const endDay = endDate.getDate();
      const startMonth = startDate.toLocaleDateString('ru-RU', { month: 'short' });
      const endMonth = endDate.toLocaleDateString('ru-RU', { month: 'short' });

      const label = startMonth === endMonth
        ? `${startDay}-${endDay} ${startMonth}`
        : `${startDay} ${startMonth} - ${endDay} ${endMonth}`;

      data.push({
        date: label,
        revenue: 0,
        leads: 0,
        dialogs: 0,
        intensive: 0,
        zoom: 0,
        conversion: 0
      });
    }
  } else {
    const months = Math.ceil(days / 30);
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      data.push({
        date: date.toLocaleDateString('ru-RU', { month: 'short' }),
        revenue: 0,
        leads: 0,
        dialogs: 0,
        intensive: 0,
        zoom: 0,
        conversion: 0
      });
    }
  }

  return data;
};

const fetchAnalyticsData = async (days, customDates) => {
  let start, end;
  if (customDates && customDates.start) {
    start = customDates.start;
    end = customDates.end || customDates.start;
    console.log('📅 Загрузка данных за период:', start, '-', end);
  } else {
    const today = new Date();
    end = formatDateString(today);
    start = formatDateString(new Date(today.getTime() - days * 24 * 60 * 60 * 1000));
    console.log('📅 Загрузка данных за', days, 'дней:', start, '-', end);
  }

  // Загружаем с сервера (единый источник правды для всех устройств)
  const serverRows = await fetchSheetData({ type: 'daily', start, end });
  console.log('📊 Получено записей с сервера:', serverRows.length);

  // Локальный кеш — только для дат которых нет на сервере (офлайн fallback)
  let localRows = [];
  try {
    const cache = JSON.parse(localStorage.getItem('localReportsCache') || '[]');
    const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
    const allLocal = [...cache, ...pending];
    const serverDates = new Set(serverRows.map(r => r.reportDate || r.date).filter(Boolean));
    localRows = allLocal.filter(r => {
      if (r.type !== 'daily') return false;
      const d = r.reportDate || r.date;
      if (!d || d < start || d > end) return false;
      return !serverDates.has(d); // только то, чего нет на сервере
    });
    console.log('📊 Локальных (не на сервере):', localRows.length);
  } catch (e) {
    console.warn('⚠️ Локальные данные:', e.message);
  }

  const rows = [...serverRows, ...localRows];
  console.log('📊 Итого:', rows.length);

  if (rows.length === 0) {
    console.log('⚠️ Нет данных, генерирую нулевые данные');
    return generateZeroData(days);
  }

  // Aggregate data by date
  const aggregated = {};
  rows.forEach(row => {
    const date = row.date || row.reportDate;
    if (!date) {
      console.warn('⚠️ Пропущена запись без даты:', row);
      return;
    }
    if (!aggregated[date]) {
      aggregated[date] = {
        date, revenue: 0, leads: 0, dialogs: 0,
        intensive: 0, zoom: 0, payments: 0,
        newPayments: 0, recurPayments: 0,
        newRevenue: 0, recurRevenue: 0,
        conversion: 0, totalLeads: 0
      };
    }
    const rowTotalUSD = row.totalUSD !== undefined && row.totalUSD !== ''
      ? Number(row.totalUSD)
      : (() => {
          const { rateUSD = 0, rateUSDT = 1, rateEUR = 0, sumUSD = 0, sumUSDT = 0, sumRUB = 0, sumEUR = 0 } = row;
          return (parseFloat(sumUSD) || 0)
            + (sumUSDT * rateUSDT)
            + (rateUSD > 0 ? sumRUB / rateUSD : 0)
            + (rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0);
        })();
    const rowNewPayments = (Number(row.newCountUSD)||0)+(Number(row.newCountUSDT)||0)+(Number(row.newCountRUB)||0)+(Number(row.newCountEUR)||0);
    const rowRecurPayments = (Number(row.recurCountUSD)||0)+(Number(row.recurCountUSDT)||0)+(Number(row.recurCountRUB)||0)+(Number(row.recurCountEUR)||0);
    const rowPayments = rowNewPayments + rowRecurPayments
      || (Number(row.countUSD)||0)+(Number(row.countUSDT)||0)+(Number(row.countRUB)||0)+(Number(row.countEUR)||0)
      || (Number(row.totalCount)||0);
    const rowNewRevenue   = Number(row.newTotalUSD)   || 0;
    const rowRecurRevenue = Number(row.recurTotalUSD) || 0;

    aggregated[date].revenue       += rowTotalUSD;
    aggregated[date].payments      += rowPayments;
    aggregated[date].newPayments   += rowNewPayments;
    aggregated[date].recurPayments += rowRecurPayments;
    aggregated[date].newRevenue    += rowNewRevenue;
    aggregated[date].recurRevenue  += rowRecurRevenue;
    aggregated[date].leads         += Number(row.newLeads) || 0;
    aggregated[date].dialogs       += Number(row.dialogs) || 0;
    aggregated[date].intensive     += Number(row.intensive) || 0;
    aggregated[date].zoom          += Number(row.zoom) || 0;
    aggregated[date].totalLeads    += Number(row.totalLeads) || 0;
  });

  const result = Object.values(aggregated).map(item => ({
    ...item,
    conversion: item.leads > 0 ? (item.payments / item.leads) * 100 : 0
  })).sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log('✅ Агрегировано записей:', result.length);
  console.log('📈 Итоговые данные:', result);

  return result;
};

export default function CRMDashboard() {
  const [activeTab, setActiveTab] = useState('daily');
  const [period, setPeriod] = useState(30);
  const [customDates, setCustomDates] = useState({ start: '', end: '' });
  const [analyticsQuery, setAnalyticsQuery] = useState({ period: 30, customDates: { start: '', end: '' } });
  const [analyticsData, setAnalyticsData] = useState([]);
  const [analyticsRefreshKey, setAnalyticsRefreshKey] = useState(0);

  const refreshAnalytics = () => setAnalyticsRefreshKey((value) => value + 1);
  const applyAnalytics = () => setAnalyticsQuery({ period, customDates });
  const setPeriodAndApply = (days) => { setPeriod(days); setAnalyticsQuery({ period: days, customDates }); };

  // Фоновая синхронизация несинхронизированных отчётов
  useEffect(() => {
    const retryPendingReports = async () => {
      try {
        const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
        if (pending.length === 0) return;

        const failed = [];
        for (const report of pending) {
          try {
            const { potentials, ...serverData } = report;
            if (serverData.potentialRows && Array.isArray(serverData.potentialRows)) {
              serverData.potentialRows = JSON.stringify(serverData.potentialRows.filter(r => r.account || r.profile));
            }
            const encoded = encodeURIComponent(JSON.stringify(serverData));
            const url = `${GOOGLE_SCRIPT_URL}?action=save&data=${encoded}`;
            const response = await fetch(url, { method: 'GET', mode: 'cors' });
            if (response && response.ok) {
              const result = await response.json();
              if (result.status === 'ok') {
                // Успешно отправлено — сохраняем в локальный кеш, удаляем из очереди
                const cache = JSON.parse(localStorage.getItem('localReportsCache') || '[]');
                cache.push(report);
                localStorage.setItem('localReportsCache', JSON.stringify(cache));
                console.log('✅ Синхронизирован:', report.reportDate || report.timestamp);
                continue;
              }
            }
          } catch (_) {}
          failed.push(report); // не удалось — оставляем в очереди
        }
        localStorage.setItem('pendingReports', JSON.stringify(failed));
      } catch (e) {
        console.warn('⚠️ Ошибка синхронизации:', e.message);
      }
    };

    retryPendingReports();
    const interval = setInterval(retryPendingReports, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') {
      const loadAnalytics = async () => {
        const fetchedData = await fetchAnalyticsData(analyticsQuery.period, analyticsQuery.customDates);
        setAnalyticsData(fetchedData);
      };

      loadAnalytics();
    }
  }, [activeTab, analyticsQuery, analyticsRefreshKey]);


  const tabs = [
    { id: 'daily',    label: 'Ежедневный',   icon: Calendar },
    { id: 'weekly',   label: 'Еженедельный', icon: BarChart },
    { id: 'monthly',  label: 'Месячный',     icon: TrendingUp },
    { id: 'analytics',label: 'Аналитика',    icon: Target },
    { id: 'reports',  label: 'Отчёты',       icon: Users }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
        * { font-family: 'Poppins', sans-serif; }
      `}</style>

      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-8 h-8 text-blue-600" />
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                CRM APCRYPTO
              </span>
              <button
                type="button"
                onClick={async () => {
                  let msg = '';
                  // localStorage
                  try {
                    const reports = JSON.parse(localStorage.getItem('pendingReports') || '[]');
                    const byType = {};
                    reports.forEach(r => { byType[r.type] = (byType[r.type]||0)+1; });
                    const dates = reports.filter(r=>r.type==='daily').map(r=>r.reportDate||r.date||'?').slice(-5).join(', ');
                    msg += `📦 localStorage\n`;
                    msg += `Всего: ${reports.length} (daily:${byType.daily||0} weekly:${byType.weekly||0} monthly:${byType.monthly||0})\n`;
                    msg += `Последние даты: ${dates||'нет'}\n\n`;
                  } catch(e) { msg += `localStorage ошибка: ${e.message}\n\n`; }
                  // Google Sheets
                  try {
                    const today = new Date();
                    const end = today.toISOString().split('T')[0];
                    const start = new Date(today-30*864e5).toISOString().split('T')[0];
                    const resp = await fetch(`${GOOGLE_SCRIPT_URL}?type=daily&start=${start}&end=${end}`);
                    if (resp.ok) {
                      const data = await resp.json();
                      const lastDate = Array.isArray(data) && data.length ? data[data.length-1].reportDate : '—';
                      msg += `☁️ Google Sheets\n`;
                      msg += `Статус: ✅ подключено\n`;
                      msg += `Записей за 30 дней: ${Array.isArray(data)?data.length:'err'}\n`;
                      msg += `Последняя дата: ${lastDate}`;
                    } else {
                      msg += `☁️ Google Sheets\nСтатус: ❌ HTTP ${resp.status}`;
                    }
                  } catch(e) { msg += `☁️ Google Sheets\nСтатус: ❌ ${e.message}`; }
                  alert(msg);
                }}
                className="ml-2 px-2 py-1 text-xs bg-slate-100 text-slate-500 rounded hover:bg-slate-200"
              >
                🔍 debug
              </button>
            </div>
            <div className="flex space-x-1">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all ${
                      activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        {activeTab === 'daily' && <DailyReport onSendSuccess={refreshAnalytics} />}
        {activeTab === 'weekly' && <WeeklyReport onSendSuccess={refreshAnalytics} />}
        {activeTab === 'monthly' && <MonthlyReport onSendSuccess={refreshAnalytics} />}
        {activeTab === 'analytics' && (
          <Analytics data={analyticsData} period={period} setPeriod={setPeriodAndApply} customDates={customDates} setCustomDates={setCustomDates} applyAnalytics={applyAnalytics} />
        )}
        {activeTab === 'reports' && <ReportsList onRefresh={refreshAnalytics} />}
      </div>
    </div>
  );
}

// REPORTS LIST
function ReportsList({ onRefresh }) {
  const [serverReports, setServerReports] = useState([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [pendingReports, setPendingReports] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pendingReports') || '[]'); } catch { return []; }
  });
  const [cacheReports] = useState(() => {
    try { return JSON.parse(localStorage.getItem('localReportsCache') || '[]'); } catch { return []; }
  });

  const loadServerReports = async () => {
    setServerLoading(true);
    try {
      const today = new Date();
      const end = today.toISOString().split('T')[0];
      const start = new Date(today - 180 * 864e5).toISOString().split('T')[0];
      const resp = await fetch(`${GOOGLE_SCRIPT_URL}?type=daily&start=${start}&end=${end}`);
      if (resp.ok) {
        const data = await resp.json();
        setServerReports(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.warn('Ошибка загрузки:', e.message); }
    setServerLoading(false);
  };

  useEffect(() => { loadServerReports(); }, []);

  // Восстановление: переотправить все данные из локального кеша на сервер
  const restoreFromCache = async () => {
    const all = [...cacheReports, ...pendingReports];
    if (all.length === 0) { setRestoreStatus('Локальный кеш пуст'); return; }
    setRestoreStatus(`Отправка ${all.length} отчётов...`);
    let ok = 0, fail = 0;
    for (const report of all) {
      try {
        const { potentialRows, potentials, ...serverData } = report;
        const encoded = encodeURIComponent(JSON.stringify(serverData));
        const resp = await fetch(`${GOOGLE_SCRIPT_URL}?action=save&data=${encoded}`);
        if (resp.ok) { const r = await resp.json(); if (r.status === 'ok') { ok++; continue; } }
      } catch (_) {}
      fail++;
    }
    setRestoreStatus(`✅ Восстановлено: ${ok}, ошибок: ${fail}`);
    await loadServerReports();
    onRefresh?.();
  };

  const deletePending = (idx) => {
    if (!confirm('Удалить этот несинхронизированный отчёт?')) return;
    const updated = pendingReports.filter((_, i) => i !== idx);
    localStorage.setItem('pendingReports', JSON.stringify(updated));
    setPendingReports(updated);
    onRefresh?.();
  };

  const typeLabel = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Месячный' };
  const typeColor = { daily: 'bg-blue-100 text-blue-700', weekly: 'bg-purple-100 text-purple-700', monthly: 'bg-green-100 text-green-700' };

  const renderRow = (r, idx, synced, onDelete) => {
    const date = r.reportDate || r.date || '—';
    const totalUSD = r.totalUSD ?? ((parseFloat(r.sumUSD)||0) + ((r.sumUSDT||0)*(r.rateUSDT||1)) + ((r.rateUSD>0)?(r.sumRUB||0)/r.rateUSD:0));
    return (
      <div key={idx} className={`flex items-center gap-3 p-4 rounded-xl border-2 ${synced ? 'border-green-100 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
        <span className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${synced ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
          {synced ? '☁️ синхр.' : '⏳ ожидает'}
        </span>
        <div className={`text-xs font-semibold px-2 py-1 rounded shrink-0 ${typeColor[r.type] || 'bg-slate-100 text-slate-600'}`}>
          {typeLabel[r.type] || r.type}
        </div>
        <div className="font-semibold text-slate-800 w-28 shrink-0">{date}</div>
        <div className="flex-1 text-sm text-slate-600 flex flex-wrap gap-3">
          {r.type === 'daily' && <><span>💰 ${Number(totalUSD).toFixed(0)}</span><span>👥 {r.newLeads||0} лидов</span><span>💬 {r.dialogs||0} диал.</span></>}
          {r.type === 'weekly' && <><span>💰 ${(r.paymentsSum||0)}</span><span>💳 {r.paymentsCount||0} оплат</span></>}
        </div>
        <div className="text-xs text-slate-400 shrink-0">{r.timestamp ? new Date(r.timestamp).toLocaleString('ru-RU') : ''}</div>
        {onDelete && (
          <button onClick={() => onDelete(idx)} className="shrink-0 w-8 h-8 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  };

  const deleteServerReport = async (r) => {
    const date = r.reportDate || r.date;
    const type = r.type || 'daily';
    if (!confirm(`Удалить отчёт за ${date} из Google Sheets?`)) return;
    try {
      const resp = await fetch(`${GOOGLE_SCRIPT_URL}?action=delete&type=${type}&date=${date}`);
      if (resp.ok) {
        const result = await resp.json();
        if (result.status === 'ok') {
          setServerReports(prev => prev.filter(x => (x.reportDate || x.date) !== date));
          onRefresh?.();
          return;
        }
        alert('Ошибка: ' + (result.error || 'неизвестно'));
      }
    } catch (e) { alert('Ошибка удаления: ' + e.message); }
  };

  const allSorted = [...serverReports].sort((a,b) => (b.reportDate||'') > (a.reportDate||'') ? 1 : -1);

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-800">📋 Отчёты</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadServerReports} disabled={serverLoading} className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 disabled:opacity-50">
            {serverLoading ? 'Загрузка...' : '🔄 Обновить'}
          </button>
          <button onClick={restoreFromCache} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
            ♻️ Восстановить из кеша ({cacheReports.length + pendingReports.length})
          </button>
        </div>
      </div>
      {restoreStatus && <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-800">{restoreStatus}</div>}

      {pendingReports.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-orange-700 mb-2">⏳ Не синхронизированы ({pendingReports.length})</h3>
          <div className="space-y-2">
            {pendingReports.map((r, i) => renderRow(r, i, false, deletePending))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-green-700 mb-2">☁️ Google Sheets — последние 90 дней ({allSorted.length})</h3>
        {serverLoading ? (
          <div className="text-center py-8 text-slate-400">Загрузка...</div>
        ) : allSorted.length === 0 ? (
          <div className="text-center py-8 text-slate-400">Нет данных на сервере</div>
        ) : (
          <div className="space-y-2">
            {allSorted.map((r, i) => renderRow(r, i, true, () => deleteServerReport(r)))}
          </div>
        )}
      </div>
    </div>
  );
}

// DAILY REPORT - COMPLETE
function DailyReport({ onSendSuccess }) {
  const draftKey = 'dailyReportDraft';
  const [paymentTab, setPaymentTab] = useState('new'); // 'new' | 'recur'
  const defaultPayFields = {
    newCountUSD: 0, newSumUSD: 0, newCountUSDT: 0, newSumUSDT: 0,
    newCountRUB: 0, newSumRUB: 0, newCountEUR: 0, newSumEUR: 0,
    recurCountUSD: 0, recurSumUSD: 0, recurCountUSDT: 0, recurSumUSDT: 0,
    recurCountRUB: 0, recurSumRUB: 0, recurCountEUR: 0, recurSumEUR: 0,
  };
  const [formData, setFormData] = useState(() => {
    const loaded = loadDraft(draftKey, {
      reportDate: formatDateString(new Date()),
      rateUSD: 95, rateEUR: 103, rateUSDT: 1,
      countUSD: 0, sumUSD: 0,
      countUSDT: 0, sumUSDT: 0,
      countRUB: 0, sumRUB: 0,
      countEUR: 0, sumEUR: 0,
      ...defaultPayFields,
      newLeads: 0, dialogs: 0, totalLeads: 0, intensive: 0, zoom: 0,
      potentialRows: Array.from({ length: 6 }, () => ({ account: '', profile: '' })),
      notes: ''
    });
    return typeof loaded === 'object' && loaded !== null ? { ...defaultPayFields, ...loaded } : {
      reportDate: formatDateString(new Date()),
      rateUSD: 95, rateEUR: 103, rateUSDT: 1,
      countUSD: 0, sumUSD: 0,
      countUSDT: 0, sumUSDT: 0,
      countRUB: 0, sumRUB: 0,
      countEUR: 0, sumEUR: 0,
      newLeads: 0, dialogs: 0, totalLeads: 0, intensive: 0, zoom: 0,
      potentialRows: Array.from({ length: 6 }, () => ({ account: '', profile: '' })),
      notes: ''
    };
  });

  useEffect(() => {
    saveDraft(draftKey, formData);
  }, [formData]);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);

  const [ratesSource, setRatesSource] = useState('');

  const fillRatesFromBybit = async () => {
    setRatesLoading(true);
    setRatesSource('');
    try {
      const { usdRub, eurRub, source } = await fetchBybitRates();
      setFormData(prev => ({
        ...prev,
        rateUSD: usdRub,
        rateUSDT: 1,
        ...(eurRub ? { rateEUR: eurRub } : {})
      }));
      setRatesSource(source);
    } catch (e) {
      alert('Не удалось получить курс: ' + e.message);
    }
    setRatesLoading(false);
  };

  const [lastSavedData, setLastSavedData] = useState(() => {
    const raw = window.localStorage.getItem('lastDailyReport');
    return raw ? JSON.parse(raw) : null;
  });

  const saveReport = (data = formData) => {
    const reportData = { ...data };
    window.localStorage.setItem('lastDailyReport', JSON.stringify(reportData));
    saveDraft(draftKey, reportData);
    setLastSavedData(reportData);
  };

  const loadReportByDate = async () => {
    if (!formData.reportDate) { alert('Выберите дату.'); return; }
    const date = formData.reportDate;

    // 1. Сначала ищем в localStorage
    try {
      const all = [
        ...JSON.parse(localStorage.getItem('localReportsCache') || '[]'),
        ...JSON.parse(localStorage.getItem('pendingReports') || '[]'),
      ];
      const found = all.filter(r => r.type === 'daily' && (r.reportDate || r.date) === date);
      if (found.length > 0) {
        const { type, timestamp, section, ...data } = found[found.length - 1];
        setFormData({ ...data, reportDate: date });
        alert(`✅ Загружен отчёт за ${date} (локальный кеш)`);
        return;
      }
    } catch (_) {}

    // 2. Запрашиваем с сервера
    try {
      const resp = await fetch(`${GOOGLE_SCRIPT_URL}?type=daily&start=${date}&end=${date}`);
      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const r = rows[0];
          setFormData(prev => ({
            ...prev,
            reportDate: date,
            rateUSD:   Number(r.rateUSD)   || prev.rateUSD,
            rateEUR:   Number(r.rateEUR)   || prev.rateEUR,
            rateUSDT:  Number(r.rateUSDT)  || prev.rateUSDT,
            totalUSD:  Number(r.totalUSD)  || 0,
            countUSD:  Number(r.countUSD)  || 0, sumUSD:  Number(r.sumUSD)  || 0,
            countUSDT: Number(r.countUSDT) || 0, sumUSDT: Number(r.sumUSDT) || 0,
            countRUB:  Number(r.countRUB)  || 0, sumRUB:  Number(r.sumRUB)  || 0,
            countEUR:  Number(r.countEUR)  || 0, sumEUR:  Number(r.sumEUR)  || 0,
            newLeads:  Number(r.newLeads)  || 0,
            dialogs:   Number(r.dialogs)   || 0,
            totalLeads:Number(r.totalLeads)|| 0,
            notes:     r.notes || '',
          }));
          alert(`✅ Загружен отчёт за ${date} (Google Sheets)`);
          return;
        }
      }
    } catch (e) {
      console.warn('Ошибка загрузки с сервера:', e.message);
    }

    alert(`Нет сохранённых отчётов за ${date}`);
  };

  const loadLastReport = () => {
    const raw = window.localStorage.getItem('lastDailyReport');
    if (!raw) {
      alert('❌ Нет предыдущего сохранённого отчёта');
      return;
    }
    const reportData = JSON.parse(raw);
    setFormData(reportData);
    setSummaryOpen(false);
    alert('✅ Предыдущий отчёт загружен');
  };

  const calc = () => {
    const r = formData;
    const { rateUSD = 95, rateEUR = 103, rateUSDT = 1 } = r;

    // Суммируем новые + рекуррентные платежи в каждой валюте
    const countUSD  = (r.newCountUSD||0)  + (r.recurCountUSD||0);
    const sumUSD    = (r.newSumUSD||0)    + (r.recurSumUSD||0);
    const countUSDT = (r.newCountUSDT||0) + (r.recurCountUSDT||0);
    const sumUSDT   = (r.newSumUSDT||0)   + (r.recurSumUSDT||0);
    const countRUB  = (r.newCountRUB||0)  + (r.recurCountRUB||0);
    const sumRUB    = (r.newSumRUB||0)    + (r.recurSumRUB||0);
    const countEUR  = (r.newCountEUR||0)  + (r.recurCountEUR||0);
    const sumEUR    = (r.newSumEUR||0)    + (r.recurSumEUR||0);

    const avgUSD  = countUSD > 0 ? sumUSD / countUSD : 0;
    const rubUSD  = sumUSD * rateUSD;
    const usdUSDT = sumUSDT * rateUSDT;
    const rubUSDT = usdUSDT * rateUSD;
    const usdRUB  = rateUSD > 0 ? sumRUB / rateUSD : 0;
    const usdEUR  = rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0;
    const rubEUR  = sumEUR * rateEUR;

    const totalCount  = countUSD + countUSDT + countRUB + countEUR;
    const totalUSD    = sumUSD + usdUSDT + usdRUB + usdEUR;
    const totalRUB    = rubUSD + rubUSDT + sumRUB + rubEUR;
    const avgTotalUSD = totalCount > 0 ? totalUSD / totalCount : 0;
    const avgTotalRUB = totalCount > 0 ? totalRUB / totalCount : 0;

    // Новые и рекуррентные в USD
    const newTotalUSD   = (r.newSumUSD||0) + (r.newSumUSDT||0)*rateUSDT + (rateUSD>0?(r.newSumRUB||0)/rateUSD:0) + (rateUSD>0?(r.newSumEUR||0)*rateEUR/rateUSD:0);
    const recurTotalUSD = (r.recurSumUSD||0) + (r.recurSumUSDT||0)*rateUSDT + (rateUSD>0?(r.recurSumRUB||0)/rateUSD:0) + (rateUSD>0?(r.recurSumEUR||0)*rateEUR/rateUSD:0);
    const newCount   = (r.newCountUSD||0) + (r.newCountUSDT||0) + (r.newCountRUB||0) + (r.newCountEUR||0);
    const recurCount = (r.recurCountUSD||0) + (r.recurCountUSDT||0) + (r.recurCountRUB||0) + (r.recurCountEUR||0);

    return { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB, newTotalUSD, recurTotalUSD, newCount, recurCount };
  };

  const { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB, newTotalUSD, recurTotalUSD, newCount, recurCount } = calc();

  const handleSend = () => {
    saveReport();
    sendToGoogleSheets({ ...formData, section: 'daily', totalUSD, newTotalUSD, recurTotalUSD }, 'daily', onSendSuccess);
    setSummaryOpen(true);
  };
  const activityConversion = formData.newLeads > 0 ? (formData.dialogs / formData.newLeads) * 100 : 0;
  const dailyPotentialCount = formData.potentialRows.length;

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">📅 Ежедневный отчёт</h2>
      <form className="space-y-6">
        
        <Section title="📅 Дата отчёта">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Inp
                label="Дата"
                type="date"
                value={formData.reportDate}
                onChange={(v) => setFormData({ ...formData, reportDate: v })}
              />
            </div>
            <button
              type="button"
              onClick={loadReportByDate}
              className="px-5 py-3 bg-slate-700 text-white rounded-xl font-semibold hover:bg-slate-800 transition-all"
            >
              Применить
            </button>
          </div>
        </Section>

        <Section title="💱 Курсы валют (для конвертации)" bg="bg-yellow-50">
          <div className="grid grid-cols-3 gap-4">
            <Inp label="USD → RUB" type="number" step="0.01" value={formData.rateUSD} onChange={(v) => setFormData({...formData, rateUSD: parseFloat(v)||0})} />
            <Inp label="EUR → RUB" type="number" step="0.01" value={formData.rateEUR} onChange={(v) => setFormData({...formData, rateEUR: parseFloat(v)||0})} />
            <Inp label="USDT → USD" type="number" step="0.01" value={formData.rateUSDT} onChange={(v) => setFormData({...formData, rateUSDT: parseFloat(v)||0})} />
          </div>
          <button
            type="button"
            onClick={fillRatesFromBybit}
            disabled={ratesLoading}
            className="mt-3 px-4 py-2 bg-yellow-500 text-white rounded-lg font-semibold text-sm hover:bg-yellow-600 disabled:opacity-50 transition-all"
          >
            {ratesLoading ? 'Загрузка...' : '📈 Получить курс с Bybit P2P'}
          </button>
          {ratesSource && <div className="mt-2 text-xs text-slate-500">Источник: {ratesSource}</div>}
        </Section>

        {/* Вкладки Новый / Рекуррентный платёж */}
        <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden">
          <div className="flex border-b border-slate-200">
            {[{id:'new',label:'🆕 Новый платёж'},{id:'recur',label:'🔄 Рекуррентный'}].map(tab => (
              <button key={tab.id} type="button"
                onClick={() => setPaymentTab(tab.id)}
                className={`flex-1 py-3 font-semibold text-sm transition-all ${paymentTab===tab.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                {tab.label}
                {tab.id==='new' && newCount>0 && <span className="ml-2 bg-white/30 text-xs px-1.5 py-0.5 rounded-full">{newCount}</span>}
                {tab.id==='recur' && recurCount>0 && <span className="ml-2 bg-white/30 text-xs px-1.5 py-0.5 rounded-full">{recurCount}</span>}
              </button>
            ))}
          </div>
          <div className="p-4 space-y-4">
            {(() => {
              const p = paymentTab === 'new' ? 'new' : 'recur';
              const f = (field) => `${p}${field}`;
              return (<>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-green-200 rounded-xl p-3 bg-green-50">
                    <div className="text-xs font-semibold text-green-700 mb-2">💵 USD</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Inp label="Кол-во" type="number" value={formData[f('CountUSD')]||0} onChange={(v) => setFormData({...formData, [f('CountUSD')]: parseFloat(v)||0})} />
                      <Inp label="Сумма ($)" type="number" step="0.01" value={formData[f('SumUSD')]||0} onChange={(v) => setFormData({...formData, [f('SumUSD')]: parseFloat(v)||0})} />
                    </div>
                  </div>
                  <div className="border border-teal-200 rounded-xl p-3 bg-teal-50">
                    <div className="text-xs font-semibold text-teal-700 mb-2">💎 USDT</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Inp label="Кол-во" type="number" value={formData[f('CountUSDT')]||0} onChange={(v) => setFormData({...formData, [f('CountUSDT')]: parseFloat(v)||0})} />
                      <Inp label="Сумма (USDT)" type="number" step="0.01" value={formData[f('SumUSDT')]||0} onChange={(v) => setFormData({...formData, [f('SumUSDT')]: parseFloat(v)||0})} />
                    </div>
                  </div>
                  <div className="border border-blue-200 rounded-xl p-3 bg-blue-50">
                    <div className="text-xs font-semibold text-blue-700 mb-2">🇷🇺 RUB</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Inp label="Кол-во" type="number" value={formData[f('CountRUB')]||0} onChange={(v) => setFormData({...formData, [f('CountRUB')]: parseFloat(v)||0})} />
                      <Inp label="Сумма (₽)" type="number" value={formData[f('SumRUB')]||0} onChange={(v) => setFormData({...formData, [f('SumRUB')]: parseFloat(v)||0})} />
                    </div>
                  </div>
                  <div className="border border-orange-200 rounded-xl p-3 bg-orange-50">
                    <div className="text-xs font-semibold text-orange-700 mb-2">💶 EUR</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Inp label="Кол-во" type="number" value={formData[f('CountEUR')]||0} onChange={(v) => setFormData({...formData, [f('CountEUR')]: parseFloat(v)||0})} />
                      <Inp label="Сумма (€)" type="number" step="0.01" value={formData[f('SumEUR')]||0} onChange={(v) => setFormData({...formData, [f('SumEUR')]: parseFloat(v)||0})} />
                    </div>
                  </div>
                </div>
                <div className="text-right text-sm text-slate-600">
                  Итого {paymentTab==='new'?'новых':'рекуррентных'}: <span className="font-bold text-slate-800">${(paymentTab==='new'?newTotalUSD:recurTotalUSD).toFixed(2)}</span>
                </div>
              </>);
            })()}
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6 text-white">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-xs opacity-75 mb-1">🆕 Новых</div>
              <div className="text-2xl font-bold">{newCount}</div>
              <div className="text-xs opacity-75">${newTotalUSD.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs opacity-75 mb-1">🔄 Рекуррент</div>
              <div className="text-2xl font-bold">{recurCount}</div>
              <div className="text-xs opacity-75">${recurTotalUSD.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Всего оплат</div>
              <div className="text-4xl font-bold">{totalCount}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Итого (USD)</div>
              <div className="text-4xl font-bold">${totalUSD.toFixed(2)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Итого (RUB)</div>
              <div className="text-3xl font-bold">{totalRUB.toFixed(0)} ₽</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Ср. чек</div>
              <div className="text-3xl font-bold">${avgTotalUSD.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Курс USD</div>
              <div className="text-2xl font-bold">{formData.rateUSD} ₽</div>
            </div>
          </div>
        </div>

        <Section title="📈 Активность">
          <div className="grid grid-cols-3 gap-4">
            <Inp label="Новых лидов *" type="number" value={formData.newLeads} onChange={(v) => setFormData({...formData, newLeads: parseFloat(v)||0})} />
            <Inp label="Открытых диалогов *" type="number" value={formData.dialogs} onChange={(v) => setFormData({...formData, dialogs: parseFloat(v)||0})} />
            <Inp label="Всего в работе *" type="number" value={formData.totalLeads} onChange={(v) => setFormData({...formData, totalLeads: parseFloat(v)||0})} />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <Inp label="⚡ Рег. интенсив" type="number" value={formData.intensive} onChange={(v) => setFormData({...formData, intensive: parseFloat(v)||0})} />
            <Inp label="🎥 Рег. Zoom" type="number" value={formData.zoom} onChange={(v) => setFormData({...formData, zoom: parseFloat(v)||0})} />
            <div className="relative group">
              <Inp label="Конверсия лид→диалог" value={`${activityConversion.toFixed(1)}%`} disabled />
              <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                {formData.dialogs} диалогов из {formData.newLeads} лидов = {activityConversion.toFixed(1)}%
              </div>
            </div>
          </div>
        </Section>

        <Section title="🔥 Потенциал">
          <div className="space-y-3">
            {formData.potentialRows.map((row, index) => (
              <div key={index} className="grid grid-cols-2 gap-3">
                <Inp
                  label={`Аккаунт ${index + 1}`}
                  type="text"
                  value={row.account}
                  placeholder="https://t.me/client"
                  onChange={(v) => {
                    const rows = [...formData.potentialRows];
                    rows[index].account = v;
                    setFormData({ ...formData, potentialRows: rows });
                  }}
                />
                <Inp
                  label={`Профайл ${index + 1}`}
                  type="text"
                  value={row.profile}
                  placeholder="Краткий профиль клиента"
                  onChange={(v) => {
                    const rows = [...formData.potentialRows];
                    rows[index].profile = v;
                    setFormData({ ...formData, potentialRows: rows });
                  }}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section title="📝 Заметки">
          <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} placeholder="Комментарии..." className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="4" />
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={loadLastReport}
            className="py-4 bg-slate-600 text-white rounded-xl font-semibold text-lg hover:shadow-xl transition-all"
          >
            Загрузить предыдущий
          </button>
          <Btn onClick={handleSend}>Сохранить и отправить отчёт</Btn>
        </div>
      </form>

      {lastSavedData && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setSummaryOpen(!summaryOpen)}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-lg hover:shadow-2xl transition-all"
          >
            {summaryOpen ? 'Скрыть сводный отчёт' : 'Показать сводный отчёт'}
          </button>
        </div>
      )}

      {summaryOpen && lastSavedData && <DailySummary data={lastSavedData} />}
    </div>
  );
}

// DAILY SUMMARY - For viewing saved daily report
function DailySummary({ data }) {
  const { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB } = (() => {
    const { rateUSD = 95, rateEUR = 103, rateUSDT = 1, countUSD = 0, sumUSD = 0, countUSDT = 0, sumUSDT = 0, countRUB = 0, sumRUB = 0, countEUR = 0, sumEUR = 0 } = data;
    
    const avgUSD = countUSD > 0 ? sumUSD / countUSD : 0;
    const rubUSD = sumUSD * rateUSD;
    const usdUSDT = sumUSDT * rateUSDT;
    const rubUSDT = usdUSDT * rateUSD;
    const usdRUB = rateUSD > 0 ? sumRUB / rateUSD : 0;
    const usdEUR = rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0;
    const rubEUR = sumEUR * rateEUR;
    
    const totalCount = parseInt(countUSD||0) + parseInt(countUSDT||0) + parseInt(countRUB||0) + parseInt(countEUR||0);
    const totalUSD = (parseFloat(sumUSD)||0) + usdUSDT + usdRUB + usdEUR;
    const totalRUB = rubUSD + rubUSDT + (parseFloat(sumRUB)||0) + rubEUR;
    const avgTotalUSD = totalCount > 0 ? totalUSD / totalCount : 0;
    const avgTotalRUB = totalCount > 0 ? totalRUB / totalCount : 0;
    
    return { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB };
  })();

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-5xl mx-auto mt-8">
      <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">📊 Сводка ежедневного отчёта</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-blue-50 rounded-xl p-6">
          <div className="text-sm text-blue-600 mb-2">Всего оплат</div>
          <div className="text-3xl font-bold text-blue-800">{totalCount}</div>
        </div>
        <div className="bg-green-50 rounded-xl p-6">
          <div className="text-sm text-green-600 mb-2">Общая сумма (USD)</div>
          <div className="text-3xl font-bold text-green-800">${totalUSD.toFixed(2)}</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-6">
          <div className="text-sm text-purple-600 mb-2">Общая сумма (RUB)</div>
          <div className="text-3xl font-bold text-purple-800">{totalRUB.toFixed(2)} ₽</div>
        </div>
        <div className="bg-orange-50 rounded-xl p-6">
          <div className="text-sm text-orange-600 mb-2">Средний чек (USD)</div>
          <div className="text-3xl font-bold text-orange-800">${avgTotalUSD.toFixed(2)}</div>
        </div>
      </div>

      <div className="space-y-6">
        <Section title="💱 Валюты">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-slate-700 mb-4">USD</h4>
              <div className="space-y-2">
                <div className="flex justify-between"><span>Количество:</span><span>{data.countUSD || 0}</span></div>
                <div className="flex justify-between"><span>Сумма:</span><span>${(data.sumUSD || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Средний чек:</span><span>${avgUSD.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>В рублях:</span><span>{rubUSD.toFixed(2)} ₽</span></div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-slate-700 mb-4">USDT</h4>
              <div className="space-y-2">
                <div className="flex justify-between"><span>Количество:</span><span>{data.countUSDT || 0}</span></div>
                <div className="flex justify-between"><span>Сумма:</span><span>{(data.sumUSDT || 0).toFixed(2)} USDT</span></div>
                <div className="flex justify-between"><span>В долларах:</span><span>${usdUSDT.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>В рублях:</span><span>{rubUSDT.toFixed(2)} ₽</span></div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-slate-700 mb-4">RUB</h4>
              <div className="space-y-2">
                <div className="flex justify-between"><span>Количество:</span><span>{data.countRUB || 0}</span></div>
                <div className="flex justify-between"><span>Сумма:</span><span>{(data.sumRUB || 0).toFixed(2)} ₽</span></div>
                <div className="flex justify-between"><span>В долларах:</span><span>${usdRUB.toFixed(2)}</span></div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-slate-700 mb-4">EUR</h4>
              <div className="space-y-2">
                <div className="flex justify-between"><span>Количество:</span><span>{data.countEUR || 0}</span></div>
                <div className="flex justify-between"><span>Сумма:</span><span>{(data.sumEUR || 0).toFixed(2)} €</span></div>
                <div className="flex justify-between"><span>В долларах:</span><span>${usdEUR.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>В рублях:</span><span>{rubEUR.toFixed(2)} ₽</span></div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="👥 Активность">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between"><span>Новых лидов:</span><span>{data.newLeads || 0}</span></div>
              <div className="flex justify-between"><span>Диалогов:</span><span>{data.dialogs || 0}</span></div>
              <div className="flex justify-between"><span>Всего в работе:</span><span>{data.totalLeads || 0}</span></div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between"><span>Регистрации интенсив:</span><span>{data.intensive || 0}</span></div>
              <div className="flex justify-between"><span>Регистрации Zoom:</span><span>{data.zoom || 0}</span></div>
              <div className="flex justify-between"><span>Конверсия:</span><span>{data.newLeads > 0 ? ((data.dialogs / data.newLeads) * 100).toFixed(1) : 0}%</span></div>
            </div>
          </div>
        </Section>

        {data.potentialRows && data.potentialRows.some(row => row.account || row.profile) && (
          <Section title="🔥 Потенциал">
            <div className="space-y-3">
              {data.potentialRows.filter(row => row.account || row.profile).map((row, index) => (
                <div key={index} className="bg-slate-50 rounded-lg p-4">
                  <div className="font-medium">{row.account || 'Аккаунт не указан'}</div>
                  <div className="text-sm text-slate-600">{row.profile || 'Профиль не указан'}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.notes && (
          <Section title="📝 Заметки">
            <p className="text-slate-700">{data.notes}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

// WEEKLY REPORT - COMPLETE
function WeeklyReport({ onSendSuccess }) {
  const draftKey = 'weeklyReportDraft';
  const [potentials, setPotentials] = useState(() => {
    const loaded = loadDraft(draftKey, Array.from({ length: 20 }, () => ({ account: '', profile: '', plannedPaymentDate: '', amount: 0 })));
    return Array.isArray(loaded) ? loaded : Array.from({ length: 20 }, () => ({ account: '', profile: '', plannedPaymentDate: '', amount: 0 }));
  });
  const [viewMode, setViewMode] = useState('edit');
  const [savedData, setSavedData] = useState(null);
  const [summaryRange, setSummaryRange] = useState({ start: '', end: '' });
  const weeklyDefaults = {
    paymentsCount: 0, paymentsSum: 0,
    newPaymentsCount: 0, newPaymentsSum: 0,
    recurPaymentsCount: 0, recurPaymentsSum: 0,
    planWeek: 0, factWeek: 0,
    newLeads: 0, openDialogs: 0, totalInWork: 0, intensive: 0, zoom: 0,
    whatWorked: '', problems: '', nextWeekPlans: '',
    weekFocus: '', weekGoalUSD: 0, weekGoalPayments: 0
  };
  const [formData, setFormData] = useState(() => {
    const loaded = loadDraft(draftKey, weeklyDefaults);
    return typeof loaded === 'object' && loaded !== null ? { ...weeklyDefaults, ...loaded } : weeklyDefaults;
  });

  useEffect(() => {
    saveDraft(draftKey, { ...formData, potentials });
  }, [formData, potentials]);

  const [weeklySummaryMessage, setWeeklySummaryMessage] = useState('');

  const handleSend = () => {
    saveReport();
    sendToGoogleSheets({ ...formData, potentials }, 'weekly', onSendSuccess);
  };

  const loadWeeklyFromDaily = async () => {
    if (!summaryRange.start || !summaryRange.end) {
      alert('Выберите дату начала и конца периода.');
      return;
    }

    const serverRows = await fetchSheetData({
      type: 'daily',
      start: summaryRange.start,
      end: summaryRange.end
    });

    let localRows = [];
    try {
      const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
      const allDates = pending.map(r => `${r.type}:${r.reportDate || r.date}`).join(', ');
      console.log('📦 pendingReports всего:', pending.length, '| Даты:', allDates);
      localRows = pending.filter(r => {
        if (r.type !== 'daily') return false;
        const d = r.reportDate || r.date;
        return d && d >= summaryRange.start && d <= summaryRange.end;
      });
    } catch (e) {
      console.warn('⚠️ Не удалось загрузить локальные данные:', e.message);
    }

    const localDates = new Set(localRows.map(r => r.reportDate || r.date).filter(Boolean));
    const rows = [...localRows, ...serverRows.filter(r => !localDates.has(r.reportDate || r.date))];

    if (rows.length === 0) {
      try {
        const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
        const allDates = pending.filter(r => r.type === 'daily').map(r => r.reportDate || r.date).join(', ');
        alert(`Нет данных за период ${summaryRange.start} — ${summaryRange.end}.\n\nВ localStorage есть отчёты за: ${allDates || 'нет'}\n\nПроверьте что период совпадает с датами отчётов.`);
      } catch (_) {
        alert('Нет данных за выбранный период.');
      }
      return;
    }

    const totals = rows.reduce(
      (acc, item) => {
        const itemRevenue = item.totalUSD !== undefined && item.totalUSD !== ''
          ? Number(item.totalUSD)
          : (() => {
              const { rateUSD = 0, rateUSDT = 1, rateEUR = 0, sumUSD = 0, sumUSDT = 0, sumRUB = 0, sumEUR = 0 } = item;
              return (parseFloat(sumUSD) || 0)
                + (sumUSDT * rateUSDT)
                + (rateUSD > 0 ? sumRUB / rateUSD : 0)
                + (rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0);
            })();
        // totalCount пустая строка в Google Sheets — всегда считаем из отдельных полей
        const itemPayments = (Number(item.countUSD) || 0) + (Number(item.countUSDT) || 0) + (Number(item.countRUB) || 0) + (Number(item.countEUR) || 0)
          || (Number(item.totalCount) || 0);
        return {
          revenue: acc.revenue + itemRevenue,
          payments: acc.payments + itemPayments,
          leads: acc.leads + (Number(item.newLeads) || 0),
          dialogs: acc.dialogs + (Number(item.dialogs) || 0),
          intensive: acc.intensive + (Number(item.intensive) || 0),
          zoom: acc.zoom + (Number(item.zoom) || 0),
          totalLeads: acc.totalLeads + (Number(item.totalLeads) || 0)
        };
      },
      { revenue: 0, payments: 0, leads: 0, dialogs: 0, intensive: 0, zoom: 0, totalLeads: 0 }
    );

    // Потенциалы берём из localStorage — в Google Sheets они не хранятся
    const localCacheInRange = (() => {
      try {
        const c = JSON.parse(localStorage.getItem('localReportsCache') || '[]');
        const p = JSON.parse(localStorage.getItem('pendingReports') || '[]');
        return [...c, ...p].filter(r => {
          if (r.type !== 'daily') return false;
          const d = r.reportDate || r.date;
          return d && d >= summaryRange.start && d <= summaryRange.end;
        });
      } catch { return []; }
    })();

    // Собираем потенциалы из Google Sheets (строка JSON) + localStorage
    const parsePotentials = (item) => {
      for (const key of ['potentialRows', 'potentials']) {
        const val = item[key];
        if (val) {
          try {
            const parsed = typeof val === 'string' ? JSON.parse(val) : val;
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          } catch { }
        }
      }
      return [];
    };

    const rawPotentials = [
      ...rows,
      ...localCacheInRange
    ].flatMap(parsePotentials);

    // Диагностика
    console.log('🔍 Потенциалы: серверных строк:', rows.length,
      '| локальных в диапазоне:', localCacheInRange.length,
      '| сырых потенциалов:', rawPotentials.length);
    localCacheInRange.forEach((r, i) => {
      console.log(`  Локальная запись [${i}] date=${r.reportDate} potentialRows=`, r.potentialRows);
    });

    const seen = new Set();
    const uniquePotentials = rawPotentials
      .filter(p => p.account || p.profile)
      .filter(p => {
        const key = (p.account || p.profile || '').trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(p => ({
        account: p.account || '',
        profile: p.profile || '',
        plannedPaymentDate: p.plannedPaymentDate || '',
        amount: Number(p.amount) || 0
      }));

    if (uniquePotentials.length > 0) {
      // Добавляем пустые строки до 20 чтобы форма была заполнена
      const padded = [...uniquePotentials];
      while (padded.length < 20) padded.push({ account: '', profile: '', plannedPaymentDate: '', amount: 0 });
      setPotentials(padded);
    }

    setFormData({
      ...formData,
      paymentsCount: totals.payments,
      paymentsSum: totals.revenue,
      newLeads: totals.leads,
      openDialogs: totals.dialogs,
      totalInWork: totals.totalLeads,
      intensive: totals.intensive,
      zoom: totals.zoom
    });
    setWeeklySummaryMessage('Данные загружены из ежедневных отчётов. Проверьте сводку и при необходимости сохраните.');
  };

  const totalPotentialSum = (Array.isArray(potentials) ? potentials : []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const avgCheck = formData.paymentsCount > 0 ? formData.paymentsSum / formData.paymentsCount : 0;
  const planPercent = formData.planWeek > 0 ? (formData.factWeek / formData.planWeek) * 100 : 0;
  const conversion = formData.newLeads > 0 ? (formData.openDialogs / formData.newLeads) * 100 : 0;

  const saveReport = () => {
    const reportData = { ...formData, potentials };
    const reportId = `weekly_${Date.now()}`;
    localStorage.setItem(reportId, JSON.stringify(reportData));
    localStorage.setItem('lastWeeklyReport', reportId);
    alert(`✅ Отчёт сохранён!\nОткройте презентацию для демонстрации в Zoom`);
    setSavedData(reportData);
  };

  const loadLastReport = () => {
    const lastId = localStorage.getItem('lastWeeklyReport');
    if (lastId) {
      const data = JSON.parse(localStorage.getItem(lastId));
      if (data) {
        setFormData(data);
        setPotentials(data.potentials || Array.from({ length: 20 }, () => ({ account: '', profile: '', plannedPaymentDate: '' })));
        setSavedData(data);
        alert('✅ Последний отчёт загружен!');
      }
    } else {
      alert('❌ Нет сохранённых отчётов');
    }
  };

  if (viewMode === 'present' && savedData) {
    return <WeeklyPresentation reportData={savedData} onClose={() => setViewMode('edit')} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">📊 Еженедельный отчёт</h2>
      <form className="space-y-6">
        
        <Section title="📅 Период сводки из ежедневных отчётов">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Inp label="Начало" type="date" value={summaryRange.start} onChange={(v) => setSummaryRange({...summaryRange, start: v})} />
            <Inp label="Конец" type="date" value={summaryRange.end} onChange={(v) => setSummaryRange({...summaryRange, end: v})} />
          </div>
          <button
            type="button"
            onClick={loadWeeklyFromDaily}
            className="px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
          >
            Загрузить из ежедневных отчётов
          </button>
          {weeklySummaryMessage && <div className="mt-3 text-sm text-slate-600">{weeklySummaryMessage}</div>}
        </Section>

        <Section title="💰 Финансовые результаты">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50">
              <div className="text-sm font-semibold text-indigo-700 mb-3">🆕 Новые оплаты</div>
              <div className="grid grid-cols-2 gap-3">
                <Inp label="Количество" type="number" value={formData.newPaymentsCount} onChange={(v) => setFormData({...formData, newPaymentsCount: parseFloat(v)||0, paymentsCount: (parseFloat(v)||0)+(formData.recurPaymentsCount||0)})} />
                <Inp label="Сумма ($)" type="number" step="0.01" value={formData.newPaymentsSum} onChange={(v) => setFormData({...formData, newPaymentsSum: parseFloat(v)||0, paymentsSum: (parseFloat(v)||0)+(formData.recurPaymentsSum||0)})} />
              </div>
            </div>
            <div className="border border-rose-200 rounded-xl p-4 bg-rose-50">
              <div className="text-sm font-semibold text-rose-700 mb-3">🔄 Рекуррентные</div>
              <div className="grid grid-cols-2 gap-3">
                <Inp label="Количество" type="number" value={formData.recurPaymentsCount} onChange={(v) => setFormData({...formData, recurPaymentsCount: parseFloat(v)||0, paymentsCount: (formData.newPaymentsCount||0)+(parseFloat(v)||0)})} />
                <Inp label="Сумма ($)" type="number" step="0.01" value={formData.recurPaymentsSum} onChange={(v) => setFormData({...formData, recurPaymentsSum: parseFloat(v)||0, paymentsSum: (formData.newPaymentsSum||0)+(parseFloat(v)||0)})} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4 bg-slate-50 rounded-xl p-3">
            <Inp label="Итого оплат" value={formData.paymentsCount} disabled />
            <Inp label="Итого сумма ($)" value={`$${(formData.paymentsSum||0).toFixed(2)}`} disabled />
            <Inp label="Средний чек ($)" value={`$${avgCheck.toFixed(2)}`} disabled />
          </div>
          <h4 className="font-semibold text-slate-700 mb-2">План vs Факт:</h4>
          <div className="grid grid-cols-3 gap-4">
            <Inp label="План ($)" type="number" step="0.01" value={formData.planWeek} onChange={(v) => setFormData({...formData, planWeek: parseFloat(v)||0})} />
            <Inp label="Факт ($)" type="number" step="0.01" value={formData.factWeek} onChange={(v) => setFormData({...formData, factWeek: parseFloat(v)||0})} />
            <Inp label="Выполнение (%)" value={`${planPercent.toFixed(1)}%`} disabled />
          </div>
        </Section>

        <Section title="📈 Активность">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Inp label="Новых лидов" type="number" value={formData.newLeads} onChange={(v) => setFormData({...formData, newLeads: parseFloat(v)||0})} />
            <Inp label="Открытых диалогов" type="number" value={formData.openDialogs} onChange={(v) => setFormData({...formData, openDialogs: parseFloat(v)||0})} />
            <Inp label="Конверсия (%)" value={`${conversion.toFixed(1)}%`} disabled />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Inp label="Всего в работе" type="number" value={formData.totalInWork} onChange={(v) => setFormData({...formData, totalInWork: parseFloat(v)||0})} />
            <Inp label="Рег. интенсив" type="number" value={formData.intensive} onChange={(v) => setFormData({...formData, intensive: parseFloat(v)||0})} />
            <Inp label="Рег. Zoom" type="number" value={formData.zoom} onChange={(v) => setFormData({...formData, zoom: parseFloat(v)||0})} />
          </div>
        </Section>

        <Section title="🔥 Потенциал">
          <p className="text-sm text-slate-600 mb-3">Потенциальные сделки с профилем и датой планируемого платежа:</p>
          {potentials.map((item, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_1.2fr_1fr_1fr_auto] gap-3 mb-3">
              <input type="text" placeholder="Аккаунт / никнейм" value={item.account} onChange={(e) => {
                const newPotentials = [...potentials];
                newPotentials[i].account = e.target.value;
                setPotentials(newPotentials);
              }} className="px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
              <input type="text" placeholder="Профиль" value={item.profile} onChange={(e) => {
                const newPotentials = [...potentials];
                newPotentials[i].profile = e.target.value;
                setPotentials(newPotentials);
              }} className="px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
              <input type="date" value={item.plannedPaymentDate} onChange={(e) => {
                const newPotentials = [...potentials];
                newPotentials[i].plannedPaymentDate = e.target.value;
                setPotentials(newPotentials);
              }} className="px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
              <input type="number" step="0.01" placeholder="Сумма" value={item.amount} onChange={(e) => {
                const newPotentials = [...potentials];
                newPotentials[i].amount = parseFloat(e.target.value) || 0;
                setPotentials(newPotentials);
              }} className="px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
              {potentials.length > 20 && (
                <button type="button" onClick={() => setPotentials(potentials.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setPotentials([...potentials, { account: '', profile: '', plannedPaymentDate: '' }])} className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 mt-2">
            <Plus className="w-4 h-4" />
            <span>Добавить потенциал</span>
          </button>
          <div className="mt-4">
            <Inp label="Ожидаемая сумма по потенциалам ($)" value={`$${totalPotentialSum.toFixed(2)}`} disabled />
          </div>
        </Section>

        <Section title="🔍 Анализ недели">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Что сработало? *</label>
              <textarea value={formData.whatWorked} onChange={(e) => setFormData({...formData, whatWorked: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Проблемы</label>
              <textarea value={formData.problems} onChange={(e) => setFormData({...formData, problems: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Планы на следующую неделю *</label>
              <textarea value={formData.nextWeekPlans} onChange={(e) => setFormData({...formData, nextWeekPlans: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
          </div>
        </Section>

        <Section title="🎯 Ставка недели">
          <p className="text-sm text-slate-600 mb-3">На чём делаете фокус на этой неделе?</p>
          <textarea 
            value={formData.weekFocus} 
            onChange={(e) => setFormData({...formData, weekFocus: e.target.value})} 
            className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" 
            rows="3"
            placeholder="Например: Делаю ставку на скорость ответов лидам и стараюсь повлиять на конверсию в открытый диалог. Или: Делаю ставку на реактивацию текущей базы чтобы повысить количество регистраций на Zoom."
          />
        </Section>

        <Section title="📊 Цель на неделю">
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Цель в долларах ($) *" type="number" step="0.01" value={formData.weekGoalUSD} onChange={(v) => setFormData({...formData, weekGoalUSD: parseFloat(v)||0})} />
            <Inp label="Цель в количестве оплат *" type="number" value={formData.weekGoalPayments} onChange={(v) => setFormData({...formData, weekGoalPayments: parseFloat(v)||0})} />
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={loadLastReport}
            className="py-4 bg-slate-600 text-white rounded-xl font-semibold text-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
          >
            <Calendar className="w-5 h-5" />
            <span>Загрузить последний</span>
          </button>
          <button
            type="button"
            onClick={saveReport}
            className="py-4 bg-green-600 text-white rounded-xl font-semibold text-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
          >
            <Send className="w-5 h-5" />
            <span>Сохранить отчёт</span>
          </button>
        </div>

        <Btn onClick={handleSend}>Сохранить и отправить отчёт</Btn>
        
        {savedData && (
          <button
            type="button"
            onClick={() => setViewMode('present')}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-lg hover:shadow-2xl transition-all flex items-center justify-center space-x-2"
          >
            <Target className="w-5 h-5" />
            <span>🎥 Открыть презентацию для Zoom</span>
          </button>
        )}
      </form>
    </div>
  );
}

// MONTHLY REPORT - COMPLETE  
function MonthlyReport({ onSendSuccess }) {
  const draftKey = 'monthlyReportDraft';
  const [products, setProducts] = useState(() => {
    const loaded = loadDraft(draftKey, [{ name: '', count: 0, sum: 0 }]);
    return Array.isArray(loaded) ? loaded : [{ name: '', count: 0, sum: 0 }];
  });
  const [viewMode, setViewMode] = useState('edit');
  const [savedData, setSavedData] = useState(null);
  const [monthlyMessage, setMonthlyMessage] = useState('');
  const [loadedRange, setLoadedRange] = useState('');
  const [reconciliation, setReconciliation] = useState(null);
  const [reconcLoading, setReconcLoading] = useState(false);

  const loadReconciliation = async () => {
    if (!formData.reportMonth) { alert('Сначала выберите месяц.'); return; }
    setReconcLoading(true);
    setReconciliation(null);
    const result = await fetchReconciliation(formData.reportMonth);
    setReconciliation(result);
    setReconcLoading(false);
  };
  const [formData, setFormData] = useState(() => {
    const loaded = loadDraft(draftKey, {
      reportMonth: '', planUSD: 0, factUSD: 0, totalPayments: 0,
      sumRUB: 0, sumUSD: 0, sumEUR: 0, sumUSDT: 0,
      newClients: 0, recurring: 0,
      totalLeads: 0, intensive: 0, zoom: 0, payments: 0,
      whatWorked: '', whatFailed: '', demandObservations: '', suggestions: '',
      enoughLeads: '', needMaterials: '', nextMonthGoals: '',
      hotLeads: 0, expectedSum: 0, challenges: '', opportunities: '', teamNeeds: '',
      nextMonthGoalUSD: 0, nextMonthGoalPayments: 0
    });
    return typeof loaded === 'object' && loaded !== null ? loaded : {
      reportMonth: '', planUSD: 0, factUSD: 0, totalPayments: 0,
      sumRUB: 0, sumUSD: 0, sumEUR: 0, sumUSDT: 0,
      newClients: 0, recurring: 0,
      totalLeads: 0, intensive: 0, zoom: 0, payments: 0,
      whatWorked: '', whatFailed: '', demandObservations: '', suggestions: '',
      enoughLeads: '', needMaterials: '', nextMonthGoals: '',
      hotLeads: 0, expectedSum: 0, challenges: '', opportunities: '', teamNeeds: '',
      nextMonthGoalUSD: 0, nextMonthGoalPayments: 0
    };
  });

  const loadMonthlyFromWeekly = async () => {
    if (!formData.reportMonth) {
      alert('Выберите месяц для загрузки данных.');
      return;
    }

    const [year, month] = formData.reportMonth.split('-');
    const start = `${year}-${month}-01`;
    const end = formatDateString(new Date(Number(year), Number(month), 0));

    // Загружаем из localStorage и с сервера, локальные имеют приоритет
    let localRows = [], dataType = 'daily';
    try {
      const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
      const localWeekly = pending.filter(r => {
        if (r.type !== 'weekly') return false;
        const d = r.reportDate || r.date;
        return d && d >= start && d <= end;
      });
      const localDaily = pending.filter(r => {
        if (r.type !== 'daily') return false;
        const d = r.reportDate || r.date;
        return d && d >= start && d <= end;
      });
      if (localWeekly.length > 0) { localRows = localWeekly; dataType = 'weekly'; }
      else if (localDaily.length > 0) { localRows = localDaily; dataType = 'daily'; }
    } catch (e) { console.warn('⚠️ Локальные данные:', e.message); }

    let serverRows = await fetchSheetData({ type: dataType === 'weekly' ? 'weekly' : 'daily', start, end });
    if (serverRows.length === 0 && dataType !== 'weekly') {
      serverRows = await fetchSheetData({ type: 'weekly', start, end });
      if (serverRows.length > 0) dataType = 'weekly';
    }

    const localDates = new Set(localRows.map(r => r.reportDate || r.date).filter(Boolean));
    const rows = [...localRows, ...serverRows.filter(r => !localDates.has(r.reportDate || r.date))];

    if (rows.length === 0) {
      const dateLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      setFormData({
        ...formData,
        planUSD: 0, factUSD: 0, totalPayments: 0, totalLeads: 0,
        intensive: 0, zoom: 0, payments: 0, newClients: 0
      });
      setLoadedRange(`Выбранный период: ${dateLabel}`);
      setMonthlyMessage('Нет данных в CRM за этот период. Показатели обнулены — можно ввести вручную или сверить с таблицей.');
      return;
    }

    const totals = rows.reduce((acc, item) => {
      if (dataType === 'weekly') {
        return {
          planUSD:       acc.planUSD       + (Number(item.planWeek)     || 0),
          factUSD:       acc.factUSD       + (Number(item.factWeek)     || 0),
          totalPayments: acc.totalPayments + (Number(item.paymentsCount)|| 0),
          totalLeads:    acc.totalLeads    + (Number(item.totalLeads)   || 0),
          intensive:     acc.intensive     + (Number(item.intensive)    || 0),
          zoom:          acc.zoom          + (Number(item.zoom)         || 0),
          payments:      acc.payments      + (Number(item.payments)     || 0),
          newClients:    acc.newClients    + (Number(item.newLeads)     || 0)
        };
      } else {
        const rev = item.totalUSD !== undefined
          ? Number(item.totalUSD)
          : (() => {
              const { rateUSD = 0, rateUSDT = 1, rateEUR = 0, sumUSD = 0, sumUSDT = 0, sumRUB = 0, sumEUR = 0 } = item;
              return (parseFloat(sumUSD) || 0)
                + (sumUSDT * rateUSDT)
                + (rateUSD > 0 ? sumRUB / rateUSD : 0)
                + (rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0);
            })();
        const pmts = item.totalCount !== undefined
          ? Number(item.totalCount)
          : (Number(item.countUSD)||0)+(Number(item.countUSDT)||0)+(Number(item.countRUB)||0)+(Number(item.countEUR)||0);
        return {
          planUSD:       acc.planUSD,
          factUSD:       acc.factUSD       + rev,
          totalPayments: acc.totalPayments + pmts,
          totalLeads:    acc.totalLeads    + (Number(item.totalLeads) || 0),
          intensive:     acc.intensive     + (Number(item.intensive)  || 0),
          zoom:          acc.zoom          + (Number(item.zoom)       || 0),
          payments:      acc.payments      + pmts,
          newClients:    acc.newClients    + (Number(item.newLeads)   || 0)
        };
      }
    }, {
      planUSD: 0, factUSD: 0, totalPayments: 0, totalLeads: 0, intensive: 0, zoom: 0, payments: 0, newClients: 0
    });

    setFormData({
      ...formData,
      planUSD: totals.planUSD,
      factUSD: totals.factUSD,
      totalPayments: totals.totalPayments,
      totalLeads: totals.totalLeads,
      intensive: totals.intensive,
      zoom: totals.zoom,
      payments: totals.payments,
      newClients: totals.newClients
    });
    const dateLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
    setLoadedRange(`Выбранный период: ${dateLabel} (${start} — ${end}), ${daysInMonth} дн.`);
    setMonthlyMessage('Данные загружены из еженедельных отчётов. Проверьте и скорректируйте при необходимости.');
  };

  const [activityLoading, setActivityLoading] = useState(false);

  const loadActivityFromDaily = async () => {
    if (!formData.reportMonth) { alert('Сначала выберите месяц.'); return; }
    setActivityLoading(true);
    const [year, month] = formData.reportMonth.split('-');
    const start = `${year}-${month}-01`;
    const end = formatDateString(new Date(Number(year), Number(month), 0));

    const serverRows = await fetchSheetData({ type: 'daily', start, end });
    let localRows = [];
    try {
      const pending = JSON.parse(localStorage.getItem('pendingReports') || '[]');
      localRows = pending.filter(r => {
        if (r.type !== 'daily') return false;
        const d = r.reportDate || r.date;
        return d && d >= start && d <= end;
      });
    } catch (_) {}

    const localDates = new Set(localRows.map(r => r.reportDate || r.date).filter(Boolean));
    const rows = [...localRows, ...serverRows.filter(r => !localDates.has(r.reportDate || r.date))];

    if (rows.length === 0) {
      alert('Нет ежедневных данных за выбранный месяц.');
      setActivityLoading(false);
      return;
    }

    const totals = rows.reduce((acc, item) => {
      const pmts = item.totalCount !== undefined
        ? Number(item.totalCount)
        : (Number(item.countUSD)||0)+(Number(item.countUSDT)||0)+(Number(item.countRUB)||0)+(Number(item.countEUR)||0);
      return {
        totalLeads: acc.totalLeads + (Number(item.totalLeads) || 0),
        newClients: acc.newClients + (Number(item.newLeads)   || 0),
        payments:   acc.payments   + pmts,
      };
    }, { totalLeads: 0, newClients: 0, payments: 0 });

    setFormData(prev => ({
      ...prev,
      totalLeads: totals.totalLeads,
      newClients: totals.newClients,
      payments:   totals.payments,
    }));
    setActivityLoading(false);
  };

  const planPercent = formData.planUSD > 0 ? (formData.factUSD / formData.planUSD) * 100 : 0;
  const convIntensive = formData.totalLeads > 0 ? (formData.intensive / formData.totalLeads) * 100 : 0;
  const convZoom = formData.intensive > 0 ? (formData.zoom / formData.intensive) * 100 : 0;
  const convPayment = formData.totalLeads > 0 ? (formData.payments / formData.totalLeads) * 100 : 0;

  useEffect(() => {
    saveDraft(draftKey, { ...formData, products });
  }, [formData, products]);

  const saveReport = () => {
    const reportData = { ...formData, products };
    const reportId = `monthly_${Date.now()}`;
    localStorage.setItem(reportId, JSON.stringify(reportData));
    localStorage.setItem('lastMonthlyReport', reportId);
    alert(`✅ Отчёт сохранён! ID: ${reportId}\nОткройте презентацию для демонстрации в Zoom`);
    setSavedData(reportData);
  };

  const handleSend = () => {
    saveReport();
    sendToGoogleSheets({ ...formData, products, section: 'monthly' }, 'monthly', onSendSuccess);
  };

  const loadLastReport = () => {
    const lastId = localStorage.getItem('lastMonthlyReport');
    if (lastId) {
      const data = JSON.parse(localStorage.getItem(lastId));
      if (data) {
        setFormData(data);
        setProducts(data.products || [{ name: '', count: 0, sum: 0 }]);
        setSavedData(data);
        alert('✅ Предыдущий отчёт загружен!');
      }
    } else {
      alert('❌ Нет сохранённых отчётов');
    }
  };

  if (viewMode === 'present' && savedData) {
    return <ReportPresentation reportData={savedData} reportType="monthly" onClose={() => setViewMode('edit')} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">📈 Месячный отчёт</h2>

      <a
        href={PAYMENTS_SHEET_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between mb-6 px-4 py-3 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors"
      >
        <span className="text-sm font-semibold text-green-800">📊 Таблица оплат клиентов (Google Sheets)</span>
        <span className="text-xs text-green-600 font-medium">Открыть →</span>
      </a>

      <form className="space-y-6">

        <Section title="💰 Финансовые результаты">
          <Inp label="Месяц и год *" type="month" value={formData.reportMonth} onChange={(v) => setFormData({...formData, reportMonth: v})} />
          <button
            type="button"
            onClick={loadMonthlyFromWeekly}
            className="mt-4 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
          >
            Применить
          </button>
          {loadedRange && <div className="mt-3 text-sm text-slate-600 font-medium">{loadedRange}</div>}
          {monthlyMessage && <div className="mt-3 text-sm text-slate-600">{monthlyMessage}</div>}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Inp label="План ($)" type="number" step="0.01" value={formData.planUSD} onChange={(v) => setFormData({...formData, planUSD: parseFloat(v)||0})} />
            <Inp label="Факт ($)" type="number" step="0.01" value={formData.factUSD} onChange={(v) => setFormData({...formData, factUSD: parseFloat(v)||0})} />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Inp label="Выполнение плана (%)" value={`${planPercent.toFixed(1)}%`} disabled />
            <Inp label="Всего оплат" type="number" value={formData.totalPayments} onChange={(v) => setFormData({...formData, totalPayments: parseFloat(v)||0})} />
          </div>
          <h4 className="font-semibold text-slate-700 mt-4 mb-2">Разбивка по валютам:</h4>
          <div className="grid grid-cols-4 gap-4">
            <Inp label="RUB" type="number" value={formData.sumRUB} onChange={(v) => setFormData({...formData, sumRUB: parseFloat(v)||0})} />
            <Inp label="USD" type="number" step="0.01" value={formData.sumUSD} onChange={(v) => setFormData({...formData, sumUSD: parseFloat(v)||0})} />
            <Inp label="EUR" type="number" step="0.01" value={formData.sumEUR} onChange={(v) => setFormData({...formData, sumEUR: parseFloat(v)||0})} />
            <Inp label="USDT" type="number" step="0.01" value={formData.sumUSDT} onChange={(v) => setFormData({...formData, sumUSDT: parseFloat(v)||0})} />
          </div>
          <h4 className="font-semibold text-slate-700 mt-4 mb-2">Типы платежей:</h4>
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Новые ($)" type="number" step="0.01" value={formData.newClients} onChange={(v) => setFormData({...formData, newClients: parseFloat(v)||0})} />
            <Inp label="Рекуррент ($)" type="number" step="0.01" value={formData.recurring} onChange={(v) => setFormData({...formData, recurring: parseFloat(v)||0})} />
          </div>
        </Section>

        <Section title="📦 Разбивка по продуктам">
          <p className="text-sm text-slate-600 mb-3">Укажите какие продукты продавали и на какую сумму</p>
          {products.map((product, i) => (
            <div key={i} className="bg-slate-50 rounded-lg p-4 mb-3">
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Название продукта</label>
                  <input type="text" placeholder="Например: FastMoney" value={product.name} onChange={(e) => {
                    const newProducts = [...products];
                    newProducts[i].name = e.target.value;
                    setProducts(newProducts);
                  }} className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Количество продаж</label>
                  <input type="number" placeholder="0" value={product.count} onChange={(e) => {
                    const newProducts = [...products];
                    newProducts[i].count = e.target.value;
                    setProducts(newProducts);
                  }} className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Общая сумма ($)</label>
                  <input type="number" placeholder="0.00" step="0.01" value={product.sum} onChange={(e) => {
                    const newProducts = [...products];
                    newProducts[i].sum = e.target.value;
                    setProducts(newProducts);
                  }} className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none" />
                </div>
                {products.length > 1 && (
                  <div className="flex items-end">
                    <button type="button" onClick={() => setProducts(products.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setProducts([...products, { name: '', count: 0, sum: 0 }])} className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
            <Plus className="w-4 h-4" />
            <span>Добавить продукт</span>
          </button>
        </Section>

        <Section title="📊 Активность за месяц">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadActivityFromDaily}
                disabled={activityLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {activityLoading ? 'Загрузка...' : '📥 Загрузить из ежедневных отчётов'}
              </button>
              <span className="text-xs text-slate-400">Суммирует лиды и оплаты по дням месяца</span>
            </div>
            <Inp label="Всего лидов" type="number" value={formData.totalLeads} onChange={(v) => setFormData({...formData, totalLeads: parseFloat(v)||0})} />
            
            <div className="grid grid-cols-2 gap-4">
              <Inp label="Регистрации в интенсив" type="number" value={formData.intensive} onChange={(v) => setFormData({...formData, intensive: parseFloat(v)||0})} />
              <Inp label="Конверсия из лида (%)" value={`${convIntensive.toFixed(1)}%`} disabled />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Inp label="Регистрации в Zoom" type="number" value={formData.zoom} onChange={(v) => setFormData({...formData, zoom: parseFloat(v)||0})} />
              <Inp label="Конверсия из рег. интенсив (%)" value={`${convZoom.toFixed(1)}%`} disabled />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Inp label="Количество оплат" type="number" value={formData.payments} onChange={(v) => setFormData({...formData, payments: parseFloat(v)||0})} />
              <Inp label="Конверсия из лида в оплату (%)" value={`${convPayment.toFixed(1)}%`} disabled />
            </div>
          </div>
        </Section>

        <Section title="🔍 Анализ месяца">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Что работало?</label>
              <textarea value={formData.whatWorked} onChange={(e) => setFormData({...formData, whatWorked: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Что не сработало?</label>
              <textarea value={formData.whatFailed} onChange={(e) => setFormData({...formData, whatFailed: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Наблюдения по спросу</label>
              <textarea value={formData.demandObservations} onChange={(e) => setFormData({...formData, demandObservations: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Предложения</label>
              <textarea value={formData.suggestions} onChange={(e) => setFormData({...formData, suggestions: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" />
            </div>
          </div>
        </Section>

        <Section title="🎯 Планирование на следующий месяц">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Цели и задачи на следующий месяц *</label>
              <textarea value={formData.nextMonthGoals} onChange={(e) => setFormData({...formData, nextMonthGoals: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="4" placeholder="Конкретные цели, KPI, задачи..." />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Inp label="Горячих лидов в работе" type="number" value={formData.hotLeads} onChange={(v) => setFormData({...formData, hotLeads: parseFloat(v)||0})} />
              <Inp label="Ожидаемая сумма от них ($)" type="number" step="0.01" value={formData.expectedSum} onChange={(v) => setFormData({...formData, expectedSum: parseFloat(v)||0})} />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Хватает ли лидов? Что можно улучшить?</label>
              <textarea value={formData.enoughLeads} onChange={(e) => setFormData({...formData, enoughLeads: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" placeholder="Оценка потока лидов, идеи по увеличению..." />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Какие материалы/ресурсы нужны для работы?</label>
              <textarea value={formData.needMaterials} onChange={(e) => setFormData({...formData, needMaterials: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" placeholder="Контент, креативы, обучение, инструменты..." />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Основные вызовы и сложности</label>
              <textarea value={formData.challenges} onChange={(e) => setFormData({...formData, challenges: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" placeholder="С чем предстоит столкнуться, какие препятствия ожидаются..." />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Возможности для роста</label>
              <textarea value={formData.opportunities} onChange={(e) => setFormData({...formData, opportunities: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" placeholder="Новые каналы, стратегии, тесты которые планируются..." />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Поддержка от команды/руководства</label>
              <textarea value={formData.teamNeeds} onChange={(e) => setFormData({...formData, teamNeeds: e.target.value})} className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none" rows="3" placeholder="Что нужно от команды, какая помощь требуется..." />
            </div>
          </div>
        </Section>

        <Section title="🎯 Цель следующего месяца">
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Цель в долларах ($) *" type="number" step="0.01" value={formData.nextMonthGoalUSD} onChange={(v) => setFormData({...formData, nextMonthGoalUSD: parseFloat(v)||0})} />
            <Inp label="Цель в количестве оплат *" type="number" value={formData.nextMonthGoalPayments} onChange={(v) => setFormData({...formData, nextMonthGoalPayments: parseFloat(v)||0})} />
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={loadLastReport}
            className="py-4 bg-slate-600 text-white rounded-xl font-semibold text-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
          >
            <Calendar className="w-5 h-5" />
            <span>Загрузить предыдущий</span>
          </button>
          <button
            type="button"
            onClick={saveReport}
            className="py-4 bg-green-600 text-white rounded-xl font-semibold text-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
          >
            <Send className="w-5 h-5" />
            <span>Сохранить отчёт</span>
          </button>
        </div>

        <Btn onClick={handleSend}>Сохранить и отправить отчёт</Btn>

        <Section title="🔍 Сверка с таблицей оплат">
          <p className="text-sm text-slate-500 mb-3">Загружает фактические оплаты за выбранный месяц прямо из Google Sheets и сравнивает с данными CRM.</p>
          <button
            type="button"
            onClick={loadReconciliation}
            disabled={reconcLoading}
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            {reconcLoading ? 'Загрузка...' : '🔄 Сверить с таблицей'}
          </button>

          {reconciliation && !reconciliation.error && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl">
                  <div className="text-xs text-slate-500 mb-1">Таблица — RUB</div>
                  <div className="text-xl font-bold text-slate-800">{reconciliation.totalRUB.toLocaleString('ru-RU')} ₽</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl">
                  <div className="text-xs text-slate-500 mb-1">Таблица — USDT</div>
                  <div className="text-xl font-bold text-slate-800">{reconciliation.totalUSDt.toFixed(2)} USDT</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                  <div className="text-xs text-blue-600 mb-1">CRM — выручка $</div>
                  <div className="text-xl font-bold text-blue-700">${formData.factUSD.toFixed(2)}</div>
                </div>
              </div>

              {reconciliation.clients.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Клиент</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-700">RUB</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-700">USDT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.clients.map((c, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-700">{c.name}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{c.rub > 0 ? `${c.rub.toLocaleString('ru-RU')} ₽` : '—'}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{c.usdt > 0 ? `${c.usdt} USDT` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold">
                      <tr className="border-t-2 border-slate-200">
                        <td className="px-4 py-3 text-slate-800">Итого ({reconciliation.clients.length} кл.)</td>
                        <td className="px-4 py-3 text-right text-slate-800">{reconciliation.totalRUB.toLocaleString('ru-RU')} ₽</td>
                        <td className="px-4 py-3 text-right text-slate-800">{reconciliation.totalUSDt.toFixed(2)} USDT</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-slate-500 mt-2">Оплат за {reconciliation.monthName} в таблице не найдено.</div>
              )}
            </div>
          )}

          {reconciliation?.error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {reconciliation.error}
            </div>
          )}
        </Section>

        {savedData && (
          <button
            type="button"
            onClick={() => setViewMode('present')}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-lg hover:shadow-2xl transition-all flex items-center justify-center space-x-2"
          >
            <Target className="w-5 h-5" />
            <span>🎥 Открыть презентацию для Zoom</span>
          </button>
        )}
      </form>
    </div>
  );
}

// ANALYTICS - COMPLETE
function Analytics({ data, period, setPeriod, customDates, setCustomDates, applyAnalytics }) {
  if (!data) return <div className="text-center py-20 text-slate-600">Загрузка...</div>;

  // Для периодов >= 90 дней группируем по месяцам, заполняя пустые месяцы нулями
  const useMonthly = period >= 90;
  const chartData = useMonthly ? (() => {
    // Агрегируем данные по месяцам
    const months = {};
    data.forEach(d => {
      const key = (d.date || d.reportDate || '').substring(0, 7);
      if (!key) return;
      if (!months[key]) months[key] = { date: key, revenue: 0, leads: 0, dialogs: 0, intensive: 0, zoom: 0, payments: 0, newPayments: 0, recurPayments: 0, newRevenue: 0, recurRevenue: 0 };
      months[key].revenue       += d.revenue || 0;
      months[key].leads         += d.leads || 0;
      months[key].dialogs       += d.dialogs || 0;
      months[key].intensive     += d.intensive || 0;
      months[key].zoom          += d.zoom || 0;
      months[key].payments      += d.payments || 0;
      months[key].newPayments   += d.newPayments   || 0;
      months[key].recurPayments += d.recurPayments || 0;
      months[key].newRevenue    += d.newRevenue    || 0;
      months[key].recurRevenue  += d.recurRevenue  || 0;
    });

    const today = new Date();
    const result = [];
    for (let i = period / 30; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push(months[key] || { date: key, revenue: 0, leads: 0, dialogs: 0, intensive: 0, zoom: 0, payments: 0, newPayments: 0, recurPayments: 0, newRevenue: 0, recurRevenue: 0 });
    }
    return result;
  })() : data;

  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);
  const totalPayments = data.reduce((sum, d) => sum + d.payments, 0);
  const totalNewPayments   = data.reduce((sum, d) => sum + (d.newPayments   || 0), 0);
  const totalRecurPayments = data.reduce((sum, d) => sum + (d.recurPayments || 0), 0);
  const totalDialogs = data.reduce((sum, d) => sum + d.dialogs, 0);
  const totalIntensive = data.reduce((sum, d) => sum + d.intensive, 0);
  const totalZoom = data.reduce((sum, d) => sum + d.zoom, 0);
  const overallConversion = totalLeads > 0 ? (totalPayments / totalLeads) * 100 : 0;

  const isEmptyData = data.every(d =>
    d.revenue === 0 && d.leads === 0 && d.dialogs === 0 && d.intensive === 0 && d.zoom === 0 && d.payments === 0
  );

  const funnelSteps = [
    { label: 'Всего лидов',      value: totalLeads,     icon: '👥', color: '#10b981' },
    { label: 'Диалоги',          value: totalDialogs,   icon: '💬', color: '#3b82f6' },
    { label: 'Рег. на интенсив', value: totalIntensive, icon: '⚡', color: '#f59e0b' },
    { label: 'Рег. на Zoom',     value: totalZoom,      icon: '🎥', color: '#ec4899' },
    { label: 'Оплаты',           value: totalPayments,  icon: '💳', color: '#14b8a6' },
  ];

  const periods = [
    { days: 7, label: '7 дней' },
    { days: 30, label: '30 дней' },
    { days: 90, label: '3 месяца' },
    { days: 180, label: '6 месяцев' },
    { days: 365, label: 'Год' }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <h2 className="text-2xl font-bold text-slate-800">📉 Аналитика</h2>
          <div className="flex flex-wrap gap-2">
            {periods.map(p => (
              <button
                key={p.days}
                onClick={() => setPeriod(p.days)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  period === p.days ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-700">Или выберите период:</label>
          <input
            type="date"
            value={customDates.start}
            onChange={(e) => setCustomDates({...customDates, start: e.target.value, end: e.target.value || customDates.end})}
            className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
          />
          <span className="text-slate-500">—</span>
          <input
            type="date"
            value={customDates.end}
            onChange={(e) => setCustomDates({...customDates, end: e.target.value})}
            className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={applyAnalytics}
            className="ml-auto px-5 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all"
          >
            Применить
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
        <div className="text-sm text-slate-600">
          {isEmptyData
            ? 'Google Sheets пока не заполнена. Аналитика будет нулевой, пока в таблице нет данных. После первой записи здесь сразу появятся актуальные цифры.'
            : 'Аналитика строится на данных из вашей Google Sheets таблицы.'}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-800">Воронка продаж</h3>
          <div className="text-sm text-slate-500">
            Сквозная конверсия:&nbsp;
            <span className="font-bold text-indigo-600">{overallConversion.toFixed(1)}%</span>
          </div>
        </div>
        <div className="space-y-1">
          {funnelSteps.map((step, i) => {
            const maxVal = totalLeads || 1;
            const pct = maxVal > 0 ? (step.value / maxVal) * 100 : 0;
            const prevVal = i > 0 ? funnelSteps[i - 1].value : null;
            const dropPct = prevVal > 0 ? ((step.value / prevVal) * 100).toFixed(0) : null;
            return (
              <div key={i}>
                {i > 0 && (
                  <div className="flex items-center justify-center py-1 text-slate-400 text-xs gap-1">
                    <span>↓</span>
                    <span>{dropPct !== null ? `${dropPct}% от предыдущего` : '—'}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-40 text-sm font-medium text-slate-600 flex items-center gap-2 shrink-0">
                    <span className="text-lg">{step.icon}</span>
                    <span>{step.label}</span>
                  </div>
                  <div className="flex-1 h-10 bg-slate-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-lg flex items-center justify-end pr-3 transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: step.color }}
                    />
                  </div>
                  <div className="w-14 text-right font-bold text-slate-800 shrink-0">{step.value}</div>
                  <div className="w-12 text-right text-sm text-slate-400 shrink-0">{pct.toFixed(0)}%</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-600 font-medium">Общая выручка за период</span>
            <span className="text-2xl font-bold text-blue-600">${totalRevenue.toFixed(0)}</span>
          </div>
          {(totalNewPayments > 0 || totalRecurPayments > 0) && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
                <div className="text-xs text-indigo-500 mb-1">🆕 Новые оплаты</div>
                <div className="text-xl font-bold text-indigo-700">{totalNewPayments}</div>
                <div className="text-xs text-indigo-400">{totalLeads > 0 ? ((totalNewPayments/totalLeads)*100).toFixed(1) : 0}% от лидов</div>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center">
                <div className="text-xs text-rose-500 mb-1">🔄 Рекуррентные</div>
                <div className="text-xl font-bold text-rose-700">{totalRecurPayments}</div>
                <div className="text-xs text-rose-400">{totalPayments > 0 ? ((totalRecurPayments/totalPayments)*100).toFixed(1) : 0}% от всех</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ChartCard title={useMonthly ? "💰 Выручка по месяцам" : "💰 Выручка по дням"}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={useMonthly ? "👥 Лиды по месяцам" : "👥 Новые лиды"}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Bar dataKey="leads" fill="#10b981" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={useMonthly ? "💬 Диалоги по месяцам" : "💬 Количество диалогов"}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Bar dataKey="dialogs" fill="#a855f7" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="⚡ Регистрации на интенсив">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="intensive" stroke="#f59e0b" strokeWidth={3} dot={{ fill: '#f59e0b', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="📹 Регистрации на Zoom">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="zoom" stroke="#ec4899" strokeWidth={3} dot={{ fill: '#ec4899', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={useMonthly ? "💳 Оплаты: новые vs рекуррентные (по месяцам)" : "💳 Оплаты: новые vs рекуррентные"}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Bar dataKey="newPayments"   name="🆕 Новые"        fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="recurPayments" name="🔄 Рекуррентные" fill="#f43f5e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="📊 Конверсия в оплату из лида">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="conversion" stroke="#6366f1" strokeWidth={3} dot={{ fill: '#6366f1', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// REPORT PRESENTATION - For Zoom demonstrations
function ReportPresentation({ reportData, reportType, onClose }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const monthlySlides = [
    { id: 'title', component: <SlideTitle title="Месячный отчёт" subtitle={reportData.reportMonth} /> },
    { id: 'financial', component: <SlideFinancial data={reportData} /> },
    { id: 'products', component: <SlideProducts products={reportData.products} /> },
    { id: 'activity', component: <SlideActivity data={reportData} /> },
    { id: 'analysis', component: <SlideAnalysis data={reportData} /> },
    { id: 'planning', component: <SlidePlanning data={reportData} /> }
  ];

  const slides = monthlySlides;
  const totalSlides = slides.length;

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 to-blue-900 z-50 overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
      `}</style>

      {/* Close button */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-50 px-4 py-2 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30"
      >
        ✕ Закрыть
      </button>

      {/* Slide Content */}
      <div className="h-screen flex items-center justify-center p-8">
        {slides[currentSlide].component}
      </div>

      {/* Navigation */}
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 z-50">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30 disabled:opacity-50 transition-all"
        >
          ← Назад
        </button>
        <div className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm">
          {currentSlide + 1} / {totalSlides}
        </div>
        <button
          onClick={() => setCurrentSlide(Math.min(totalSlides - 1, currentSlide + 1))}
          disabled={currentSlide === totalSlides - 1}
          className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30 disabled:opacity-50 transition-all"
        >
          Далее →
        </button>
      </div>

      {/* Slide Indicators */}
      <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 flex space-x-2 z-50">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={`w-3 h-3 rounded-full transition-all ${
              i === currentSlide ? 'bg-white w-8' : 'bg-white/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// WEEKLY PRESENTATION - For Zoom demonstrations
function WeeklyPresentation({ reportData, onClose }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    { id: 'title', component: <SlideTitle title="Еженедельный отчёт" subtitle="Итоги недели" /> },
    { id: 'financial', component: <WeeklySlideFinancial data={reportData} /> },
    { id: 'activity', component: <WeeklySlideActivity data={reportData} /> },
    { id: 'potential', component: <WeeklySlidePotential data={reportData} /> },
    { id: 'analysis', component: <WeeklySlideAnalysis data={reportData} /> },
    { id: 'focus', component: <WeeklySlideFocus data={reportData} /> }
  ];

  const totalSlides = slides.length;

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 to-blue-900 z-50 overflow-hidden">
      <button onClick={onClose} className="fixed top-4 right-4 z-50 px-4 py-2 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30">
        ✕ Закрыть
      </button>

      <div className="h-screen flex items-center justify-center p-8">
        {slides[currentSlide].component}
      </div>

      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 z-50">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30 disabled:opacity-50 transition-all"
        >
          ← Назад
        </button>
        <div className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm">
          {currentSlide + 1} / {totalSlides}
        </div>
        <button
          onClick={() => setCurrentSlide(Math.min(totalSlides - 1, currentSlide + 1))}
          disabled={currentSlide === totalSlides - 1}
          className="px-6 py-3 bg-white/20 text-white rounded-lg backdrop-blur-sm hover:bg-white/30 disabled:opacity-50 transition-all"
        >
          Далее →
        </button>
      </div>

      <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 flex space-x-2 z-50">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={`w-3 h-3 rounded-full transition-all ${
              i === currentSlide ? 'bg-white w-8' : 'bg-white/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// Weekly Presentation Slides
function WeeklySlideFinancial({ data }) {
  const planPercent = (data.planWeek || 0) > 0 ? ((data.factWeek || 0) / (data.planWeek || 0)) * 100 : 0;
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">💰 Финансы</h2>
      <div className="grid grid-cols-3 gap-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">Оплаты</div>
          <div className="text-5xl font-bold">{data.paymentsCount || 0}</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">Сумма</div>
          <div className="text-5xl font-bold">${(data.paymentsSum || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">План</div>
          <div className="text-3xl font-bold">${(data.planWeek || 0).toLocaleString()}</div>
          <div className={`text-2xl mt-2 ${planPercent >= 100 ? 'text-green-400' : 'text-orange-400'}`}>{planPercent.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}

function WeeklySlideActivity({ data }) {
  const conversion = (data.newLeads || 0) > 0 ? ((data.openDialogs || 0) / (data.newLeads || 0)) * 100 : 0;
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">📊 Активность</h2>
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-12">
        <div className="grid grid-cols-3 gap-8 mb-12">
          <div className="text-center">
            <div className="text-xl opacity-70 mb-2">Новых лидов</div>
            <div className="text-5xl font-bold">{data.newLeads || 0}</div>
          </div>
          <div className="text-center">
            <div className="text-xl opacity-70 mb-2">Диалоги</div>
            <div className="text-5xl font-bold">{data.openDialogs || 0}</div>
          </div>
          <div className="text-center">
            <div className="text-xl opacity-70 mb-2">Конверсия</div>
            <div className="text-5xl font-bold text-green-400">{conversion.toFixed(1)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-8">
          <div className="bg-white/5 rounded-xl p-6 text-center">
            <div className="text-lg mb-2">Всего в работе</div>
            <div className="text-4xl font-bold">{data.totalInWork || 0}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-6 text-center">
            <div className="text-lg mb-2">Рег. интенсив</div>
            <div className="text-4xl font-bold">{data.intensive || 0}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-6 text-center">
            <div className="text-lg mb-2">Рег. Zoom</div>
            <div className="text-4xl font-bold">{data.zoom || 0}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklySlidePotential({ data }) {
  const validPotentials = (data.potentials || []).filter((item) => item.account || item.profile);
  const totalPotentialSum = (data.potentials || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">🔥 Потенциал</h2>
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-12">
        <div className="text-3xl font-semibold mb-8">Ожидаемая сумма: ${totalPotentialSum.toLocaleString()}</div>
        {validPotentials.length > 0 ? (
          <div className="grid grid-cols-2 gap-6">
            {validPotentials.map((item, i) => (
              <div key={i} className="bg-white/5 rounded-xl p-6">
                <div className="text-2xl font-semibold mb-2">{item.account || item.profile}</div>
                <div className="text-lg opacity-70">{item.plannedPaymentDate || 'Дата не указана'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-2xl opacity-70">Клиенты не указаны</div>
        )}
      </div>
    </div>
  );
}

function WeeklySlideAnalysis({ data }) {
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">🔍 Анализ</h2>
      <div className="space-y-6">
        <div className="bg-green-500/20 rounded-2xl p-8 border-2 border-green-500/50">
          <h3 className="text-3xl font-semibold mb-4">✅ Что сработало</h3>
          <p className="text-xl opacity-90">{data.whatWorked || 'Не указано'}</p>
        </div>
        <div className="bg-red-500/20 rounded-2xl p-8 border-2 border-red-500/50">
          <h3 className="text-3xl font-semibold mb-4">❌ Проблемы</h3>
          <p className="text-xl opacity-90">{data.problems || 'Не указано'}</p>
        </div>
        <div className="bg-blue-500/20 rounded-2xl p-8 border-2 border-blue-500/50">
          <h3 className="text-3xl font-semibold mb-4">📋 Планы на следующую неделю</h3>
          <p className="text-xl opacity-90">{data.nextWeekPlans || 'Не указано'}</p>
        </div>
      </div>
    </div>
  );
}

function WeeklySlideFocus({ data }) {
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">🎯 Фокус недели</h2>
      <div className="bg-purple-500/20 backdrop-blur-sm rounded-2xl p-12 border-2 border-purple-500/50 mb-8">
        <h3 className="text-3xl font-semibold mb-6">Ставка недели</h3>
        <p className="text-2xl leading-relaxed opacity-90">{data.weekFocus || 'Не указано'}</p>
      </div>
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">Цель в долларах</div>
          <div className="text-5xl font-bold">${(data.weekGoalUSD || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">Цель в оплатах</div>
          <div className="text-5xl font-bold">{data.weekGoalPayments || 0}</div>
        </div>
      </div>
    </div>
  );
}

// Presentation Slides
function SlideTitle({ title, subtitle }) {
  return (
    <div className="text-center text-white">
      <div className="text-8xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
        {title}
      </div>
      <div className="text-4xl font-light opacity-80">{subtitle}</div>
    </div>
  );
}

function SlideFinancial({ data }) {
  const planPercent = data.planUSD > 0 ? (data.factUSD / data.planUSD) * 100 : 0;
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">💰 Финансы</h2>
      <div className="grid grid-cols-3 gap-8 mb-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">План</div>
          <div className="text-5xl font-bold">${data.planUSD.toLocaleString()}</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-xl opacity-70 mb-2">Факт</div>
          <div className="text-5xl font-bold">${data.factUSD.toLocaleString()}</div>
        </div>
        <div className={`backdrop-blur-sm rounded-2xl p-8 ${planPercent >= 100 ? 'bg-green-500/20 ring-4 ring-green-400' : 'bg-white/10'}`}>
          <div className="text-xl opacity-70 mb-2">Выполнение</div>
          <div className="text-5xl font-bold">{planPercent.toFixed(1)}%</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
          <h3 className="text-2xl font-semibold mb-4">Новые vs Рекуррент</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span>Новые</span>
                <span className="font-bold">${data.newClients.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-green-500" style={{ width: `${(data.newClients / (data.newClients + data.recurring)) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span>Рекуррент</span>
                <span className="font-bold">${data.recurring.toLocaleString()}</span>
              </div>
              <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${(data.recurring / (data.newClients + data.recurring)) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
          <h3 className="text-2xl font-semibold mb-4">По валютам</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'RUB', value: data.sumRUB },
              { label: 'USD', value: data.sumUSD },
              { label: 'EUR', value: data.sumEUR },
              { label: 'USDT', value: data.sumUSDT }
            ].filter(c => c.value > 0).map((currency, i) => (
              <div key={i} className="bg-white/5 rounded-lg p-3">
                <div className="text-sm opacity-70">{currency.label}</div>
                <div className="text-2xl font-bold">{currency.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideProducts({ products }) {
  const validProducts = products.filter(p => p.name && p.sum > 0);
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">📦 Продукты</h2>
      {validProducts.length > 0 ? (
        <div className="grid grid-cols-3 gap-6">
          {validProducts.map((product, i) => (
            <div key={i} className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <div className="text-2xl font-semibold mb-2">{product.name}</div>
              <div className="text-4xl font-bold text-blue-400 mb-2">{product.count}</div>
              <div className="text-xl text-green-400">${parseFloat(product.sum).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-2xl opacity-70">Нет данных</div>
      )}
    </div>
  );
}

function SlideActivity({ data }) {
  const convIntensive = data.totalLeads > 0 ? (data.intensive / data.totalLeads) * 100 : 0;
  const convZoom = data.intensive > 0 ? (data.zoom / data.intensive) * 100 : 0;
  const convPayment = data.totalLeads > 0 ? (data.payments / data.totalLeads) * 100 : 0;
  const funnelData = [
    { stage: 'Лиды', value: data.totalLeads, percent: 100 },
    { stage: 'Интенсив', value: data.intensive, percent: convIntensive },
    { stage: 'Zoom', value: data.zoom, percent: convZoom },
    { stage: 'Оплаты', value: data.payments, percent: convPayment }
  ];
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">📊 Воронка</h2>
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-12">
        <div className="space-y-8">
          {funnelData.map((item, i) => (
            <div key={i}>
              <div className="flex justify-between mb-2">
                <span className="text-2xl font-semibold">{item.stage}</span>
                <div className="text-right">
                  <div className="text-3xl font-bold">{item.value}</div>
                  {i > 0 && <div className="text-green-400">{item.percent.toFixed(1)}%</div>}
                </div>
              </div>
              <div className="h-6 bg-white/20 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${i === 0 ? 'bg-blue-500' : i === 1 ? 'bg-green-500' : i === 2 ? 'bg-purple-500' : 'bg-orange-500'}`}
                  style={{ width: `${(item.value / funnelData[0].value) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SlideAnalysis({ data }) {
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">🔍 Анализ</h2>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-green-500/20 rounded-2xl p-6 border-2 border-green-500/50">
          <h3 className="text-2xl font-semibold mb-3">✅ Работало</h3>
          <p className="text-lg opacity-90">{data.whatWorked || 'Не указано'}</p>
        </div>
        <div className="bg-red-500/20 rounded-2xl p-6 border-2 border-red-500/50">
          <h3 className="text-2xl font-semibold mb-3">❌ Не сработало</h3>
          <p className="text-lg opacity-90">{data.whatFailed || 'Не указано'}</p>
        </div>
        <div className="bg-blue-500/20 rounded-2xl p-6 border-2 border-blue-500/50">
          <h3 className="text-2xl font-semibold mb-3">💡 Наблюдения</h3>
          <p className="text-lg opacity-90">{data.demandObservations || 'Не указано'}</p>
        </div>
        <div className="bg-purple-500/20 rounded-2xl p-6 border-2 border-purple-500/50">
          <h3 className="text-2xl font-semibold mb-3">💭 Предложения</h3>
          <p className="text-lg opacity-90">{data.suggestions || 'Не указано'}</p>
        </div>
      </div>
    </div>
  );
}

function SlidePlanning({ data }) {
  return (
    <div className="w-full max-w-6xl text-white">
      <h2 className="text-5xl font-bold mb-12 text-center">🎯 Планы</h2>
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
          <div className="text-lg opacity-70 mb-2">Горячих лидов</div>
          <div className="text-5xl font-bold">{data.hotLeads || 0}</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
          <div className="text-lg opacity-70 mb-2">Ожидаемая сумма</div>
          <div className="text-5xl font-bold">${(data.expectedSum || 0).toLocaleString()}</div>
        </div>
      </div>
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8">
        <h3 className="text-3xl font-semibold mb-4">Цели</h3>
        <p className="text-xl opacity-90 mb-6">{data.nextMonthGoals || 'Не указано'}</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="text-xl font-semibold mb-2 text-green-400">✅ Возможности</h4>
            <p className="opacity-80">{data.opportunities || 'Не указано'}</p>
          </div>
          <div>
            <h4 className="text-xl font-semibold mb-2 text-orange-400">⚠️ Вызовы</h4>
            <p className="opacity-80">{data.challenges || 'Не указано'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// HELPER COMPONENTS
const Section = ({ title, children, color = 'border-blue-500', bg = 'bg-blue-50' }) => (
  <div className={`border-l-4 ${color} ${bg} rounded-lg p-6`}>
    <h3 className="text-lg font-semibold text-slate-800 mb-4">{title}</h3>
    {children}
  </div>
);

const Inp = ({ label, value, onChange, disabled = false, type = 'text', ...props }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
      disabled={disabled}
      className={`w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors ${
        disabled ? 'bg-slate-100 cursor-not-allowed text-blue-600 font-semibold' : ''
      }`}
      {...props}
    />
  </div>
);

const Btn = ({ children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg hover:shadow-2xl transition-all flex items-center justify-center space-x-2"
  >
    <Send className="w-5 h-5" />
    <span>{children}</span>
  </button>
);

const ChartCard = ({ title, children }) => (
  <div className="bg-white rounded-2xl shadow-xl p-6">
    <h3 className="text-xl font-bold text-slate-800 mb-4">{title}</h3>
    {children}
  </div>
);
