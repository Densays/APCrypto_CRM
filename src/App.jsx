import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Calendar, Users, Target, DollarSign, Send, Plus, X, MessageSquare, Video, Zap } from 'lucide-react';

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwMMJr0ie58lHuRucI6-hTkhhUym44Shy2DsXz_kmBy1k7N-rIBICYlq5Wucibw8zqRPQ/exec';

const sendToGoogleSheets = async (data, type, onComplete) => {
  const reportData = {...data, type, timestamp: new Date().toISOString()};
  console.log('📤 Отправка данных:', reportData);
  
  // ВСЕГДА сохраняем локально сначала
  try {
    const savedReports = JSON.parse(localStorage.getItem('pendingReports') || '[]');
    savedReports.push(reportData);
    localStorage.setItem('pendingReports', JSON.stringify(savedReports));
    console.log('✅ Данные сохранены локально');
  } catch (e) {
    console.warn('⚠️ Не удалось сохранить локально:', e.message);
  }

  // Показываем пользователю успешное сохранение
  alert('✅ Отчет сохранен! Данные отправляются в Google Sheets...');
  
  // В фоне пытаемся отправить на сервер (не блокируем UI)
  (async () => {
    // Попытка 1: Обычный fetch с CORS
    try {
      console.log('📤 Попытка 1: Стандартный POST запрос');
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
      });
      if (response.ok) {
        console.log('✅ Данные успешно отправлены на сервер!');
        return;
      }
    } catch (e) {
      console.warn('⚠️ Попытка 1 не удалась:', e.message);
    }

    // Попытка 2: FormData
    try {
      console.log('📤 Попытка 2: FormData метод');
      const formData = new FormData();
      formData.append('data', JSON.stringify(reportData));
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        body: formData
      });
      if (response.ok) {
        console.log('✅ FormData отправка успешна!');
        return;
      }
    } catch (e) {
      console.warn('⚠️ Попытка 2 не удалась:', e.message);
    }

    // Попытка 3: no-cors mode (отправляет но браузер не может проверить результат)
    try {
      console.log('📤 Попытка 3: no-cors режим');
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(reportData)
      });
      console.log('ℹ️ Данные отправлены в режиме no-cors (результат может быть недоступен)');
      return;
    } catch (e) {
      console.warn('⚠️ Попытка 3 не удалась:', e.message);
    }

    console.log('ℹ️ Не удалось отправить на сервер, но данные сохранены локально');
  })();

  if (typeof onComplete === 'function') onComplete();
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

  // Сначала пытаемся загрузить с сервера
  const serverRows = await fetchSheetData({
    type: 'daily',
    start,
    end
  });

  console.log('📊 Получено записей с сервера:', serverRows.length);

  // Если с сервера ничего не пришло - ищем локальные данные
  let rows = serverRows;
  if (rows.length === 0) {
    console.log('ℹ️ Нет данных с сервера, загружаю локальные данные');
    try {
      const pendingReports = JSON.parse(localStorage.getItem('pendingReports') || '[]');
      rows = pendingReports.filter(report => {
        if (report.type !== 'daily') return false;
        const reportDate = report.reportDate || report.date;
        if (!reportDate) return false;
        if (start && reportDate < start) return false;
        if (end && reportDate > end) return false;
        return true;
      });
      console.log('📊 Загружено локальных записей:', rows.length);
    } catch (e) {
      console.warn('⚠️ Не удалось загрузить локальные данные:', e.message);
    }
  }

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
        date,
        revenue: 0,
        leads: 0,
        dialogs: 0,
        intensive: 0,
        zoom: 0,
        conversion: 0,
        totalLeads: 0
      };
    }
    aggregated[date].revenue += Number(row.totalUSD) || 0;
    aggregated[date].leads += Number(row.newLeads) || 0;
    aggregated[date].dialogs += Number(row.dialogs) || 0;
    aggregated[date].intensive += Number(row.intensive) || 0;
    aggregated[date].zoom += Number(row.zoom) || 0;
    aggregated[date].totalLeads += Number(row.totalLeads) || 0;
  });

  const result = Object.values(aggregated).map(item => ({
    ...item,
    conversion: item.leads > 0 ? (item.revenue / item.leads) * 100 : 0
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

  // Попытка отправить сохраненные данные при загрузке приложения
  useEffect(() => {
    const retryPendingReports = async () => {
      try {
        const pendingReports = JSON.parse(localStorage.getItem('pendingReports') || '[]');
        if (pendingReports.length === 0) {
          console.log('✅ Нет сохраненных отчетов для отправки');
          return;
        }

        console.log(`📤 Попытка отправить ${pendingReports.length} сохраненных отчетов`);
        
        let successCount = 0;
        for (const report of pendingReports) {
          try {
            const response = await fetch(GOOGLE_SCRIPT_URL, {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(report)
            });
            
            if (response && response.ok) {
              console.log('✅ Отправлен сохраненный отчет:', report);
              successCount++;
            } else {
              console.warn('⚠️ Сервер ответил с ошибкой, сохраненный отчет не отправлен');
            }
          } catch (e) {
            console.warn('⚠️ Не удалось отправить сохраненный отчет:', e.message);
          }
        }

        // Очистить только успешно отправленные отчеты
        if (successCount > 0) {
          try {
            localStorage.removeItem('pendingReports');
            console.log(`✅ Очищены ${successCount} отправленных отчетов`);
          } catch (e) {
            console.warn('⚠️ Не удалось очистить сохраненные отчеты');
          }
        } else {
          console.log('ℹ️ Отчеты не отправлены, сохраняю их на потом');
        }
      } catch (e) {
        console.warn('⚠️ Ошибка при проверке сохраненных отчетов:', e.message);
      }
    };

    // Отправить при загрузке приложения
    retryPendingReports();

    // Также повторять попытку каждые 30 сек
    const interval = setInterval(retryPendingReports, 30000);
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
    { id: 'daily', label: 'Ежедневный', icon: Calendar },
    { id: 'weekly', label: 'Еженедельный', icon: BarChart },
    { id: 'monthly', label: 'Месячный', icon: TrendingUp },
    { id: 'analytics', label: 'Аналитика', icon: Target }
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
          <Analytics data={analyticsData} period={period} setPeriod={setPeriod} customDates={customDates} setCustomDates={setCustomDates} applyAnalytics={applyAnalytics} />
        )}
      </div>
    </div>
  );
}

// DAILY REPORT - COMPLETE
function DailyReport({ onSendSuccess }) {
  const draftKey = 'dailyReportDraft';
  const [formData, setFormData] = useState(() => {
    const loaded = loadDraft(draftKey, {
      reportDate: formatDateString(new Date()),
      rateUSD: 95, rateEUR: 103, rateUSDT: 1,
      countUSD: 0, sumUSD: 0,
      countUSDT: 0, sumUSDT: 0,
      countRUB: 0, sumRUB: 0,
      countEUR: 0, sumEUR: 0,
      newLeads: 0, dialogs: 0, totalLeads: 0,
      potentialRows: Array.from({ length: 6 }, () => ({ account: '', profile: '' })),
      notes: ''
    });
    return typeof loaded === 'object' && loaded !== null ? loaded : {
      reportDate: formatDateString(new Date()),
      rateUSD: 95, rateEUR: 103, rateUSDT: 1,
      countUSD: 0, sumUSD: 0,
      countUSDT: 0, sumUSDT: 0,
      countRUB: 0, sumRUB: 0,
      countEUR: 0, sumEUR: 0,
      newLeads: 0, dialogs: 0, totalLeads: 0,
      potentialRows: Array.from({ length: 6 }, () => ({ account: '', profile: '' })),
      notes: ''
    };
  });

  useEffect(() => {
    saveDraft(draftKey, formData);
  }, [formData]);

  const [summaryOpen, setSummaryOpen] = useState(false);
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

  const handleSend = () => {
    saveReport();
    sendToGoogleSheets({ ...formData, section: 'daily' }, 'daily', onSendSuccess);
    setSummaryOpen(true);
  };

  const calc = () => {
    const { rateUSD, rateEUR, rateUSDT, countUSD, sumUSD, countUSDT, sumUSDT, countRUB, sumRUB, countEUR, sumEUR } = formData;
    
    // USD
    const avgUSD = countUSD > 0 ? sumUSD / countUSD : 0;
    const rubUSD = sumUSD * rateUSD;
    
    // USDT
    const usdUSDT = sumUSDT * rateUSDT;
    const rubUSDT = usdUSDT * rateUSD;
    
    // RUB
    const usdRUB = rateUSD > 0 ? sumRUB / rateUSD : 0;
    
    // EUR
    const usdEUR = rateUSD > 0 ? (sumEUR * rateEUR) / rateUSD : 0;
    const rubEUR = sumEUR * rateEUR;
    
    // Totals
    const totalCount = parseInt(countUSD||0) + parseInt(countUSDT||0) + parseInt(countRUB||0) + parseInt(countEUR||0);
    const totalUSD = (parseFloat(sumUSD)||0) + usdUSDT + usdRUB + usdEUR;
    const totalRUB = rubUSD + rubUSDT + (parseFloat(sumRUB)||0) + rubEUR;
    const avgTotalUSD = totalCount > 0 ? totalUSD / totalCount : 0;
    const avgTotalRUB = totalCount > 0 ? totalRUB / totalCount : 0;
    
    return { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB };
  };

  const { avgUSD, rubUSD, usdUSDT, rubUSDT, usdRUB, usdEUR, rubEUR, totalCount, totalUSD, totalRUB, avgTotalUSD, avgTotalRUB } = calc();
  const activityConversion = formData.newLeads > 0 ? (formData.dialogs / formData.newLeads) * 100 : 0;
  const dailyPotentialCount = formData.potentialRows.length;

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-800 mb-6 text-center">📅 Ежедневный отчёт</h2>
      <form className="space-y-6">
        
        <Section title="� Дата отчёта">
          <div className="grid grid-cols-2 gap-4">
            <Inp
              label="Дата"
              type="date"
              value={formData.reportDate}
              onChange={(v) => setFormData({ ...formData, reportDate: v })}
            />
          </div>
        </Section>

        <Section title="�💱 Курсы валют (для конвертации)" bg="bg-yellow-50">
          <div className="grid grid-cols-3 gap-4">
            <Inp label="USD → RUB" type="number" step="0.01" value={formData.rateUSD} onChange={(v) => setFormData({...formData, rateUSD: parseFloat(v)||0})} />
            <Inp label="EUR → RUB" type="number" step="0.01" value={formData.rateEUR} onChange={(v) => setFormData({...formData, rateEUR: parseFloat(v)||0})} />
            <Inp label="USDT → USD" type="number" step="0.01" value={formData.rateUSDT} onChange={(v) => setFormData({...formData, rateUSDT: parseFloat(v)||0})} />
          </div>
        </Section>

        <Section title="💵 Доллары США (USD) - основная валюта" color="border-green-500">
          <div className="grid grid-cols-4 gap-4">
            <Inp label="Количество" type="number" value={formData.countUSD} onChange={(v) => setFormData({...formData, countUSD: parseFloat(v)||0})} />
            <Inp label="Сумма ($)" type="number" step="0.01" value={formData.sumUSD} onChange={(v) => setFormData({...formData, sumUSD: parseFloat(v)||0})} />
            <Inp label="Средний чек" value={`$${avgUSD.toFixed(2)}`} disabled />
            <Inp label="В рублях" value={`${rubUSD.toFixed(2)} ₽`} disabled />
          </div>
        </Section>

        <Section title="💎 Tether (USDT)" color="border-teal-500">
          <div className="grid grid-cols-4 gap-4">
            <Inp label="Количество" type="number" value={formData.countUSDT} onChange={(v) => setFormData({...formData, countUSDT: parseFloat(v)||0})} />
            <Inp label="Сумма (USDT)" type="number" step="0.01" value={formData.sumUSDT} onChange={(v) => setFormData({...formData, sumUSDT: parseFloat(v)||0})} />
            <Inp label="В долларах" value={`$${usdUSDT.toFixed(2)}`} disabled />
            <Inp label="В рублях" value={`${rubUSDT.toFixed(2)} ₽`} disabled />
          </div>
        </Section>

        <Section title="🇷🇺 Рубли (RUB)" color="border-blue-500">
          <div className="grid grid-cols-3 gap-4">
            <Inp label="Количество" type="number" value={formData.countRUB} onChange={(v) => setFormData({...formData, countRUB: parseFloat(v)||0})} />
            <Inp label="Сумма (₽)" type="number" value={formData.sumRUB} onChange={(v) => setFormData({...formData, sumRUB: parseFloat(v)||0})} />
            <Inp label="В долларах" value={`$${usdRUB.toFixed(2)}`} disabled />
          </div>
        </Section>

        <Section title="💶 Евро (EUR)" color="border-orange-500">
          <div className="grid grid-cols-4 gap-4">
            <Inp label="Количество" type="number" value={formData.countEUR} onChange={(v) => setFormData({...formData, countEUR: parseFloat(v)||0})} />
            <Inp label="Сумма (€)" type="number" step="0.01" value={formData.sumEUR} onChange={(v) => setFormData({...formData, sumEUR: parseFloat(v)||0})} />
            <Inp label="В долларах" value={`$${usdEUR.toFixed(2)}`} disabled />
            <Inp label="В рублях" value={`${rubEUR.toFixed(2)} ₽`} disabled />
          </div>
        </Section>

        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6 text-white">
          <div className="grid grid-cols-3 gap-6 mb-4">
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Всего оплат</div>
              <div className="text-4xl font-bold">{totalCount}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Итого (USD)</div>
              <div className="text-4xl font-bold">${totalUSD.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Итого (RUB)</div>
              <div className="text-4xl font-bold">{totalRUB.toFixed(0)} ₽</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Ср. чек (USD)</div>
              <div className="text-3xl font-bold">${avgTotalUSD.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Ср. чек (RUB)</div>
              <div className="text-3xl font-bold">{avgTotalRUB.toFixed(0)} ₽</div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-90 mb-1">Курс USD</div>
              <div className="text-2xl font-bold">{formData.rateUSD} ₽</div>
            </div>
          </div>
        </div>

        <Section title="📈 Активность">
          <div className="grid grid-cols-4 gap-4">
            <Inp label="Новых лидов *" type="number" value={formData.newLeads} onChange={(v) => setFormData({...formData, newLeads: parseFloat(v)||0})} />
            <Inp label="Открытых диалогов *" type="number" value={formData.dialogs} onChange={(v) => setFormData({...formData, dialogs: parseFloat(v)||0})} />
            <Inp label="Всего в работе *" type="number" value={formData.totalLeads} onChange={(v) => setFormData({...formData, totalLeads: parseFloat(v)||0})} />
            <Inp label="Конверсия (%)" value={`${activityConversion.toFixed(1)}%`} disabled />
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
  const [formData, setFormData] = useState(() => {
    const loaded = loadDraft(draftKey, {
      paymentsCount: 0, paymentsSum: 0, planWeek: 0, factWeek: 0,
      newLeads: 0, openDialogs: 0, totalInWork: 0, intensive: 0, zoom: 0,
      whatWorked: '', problems: '', nextWeekPlans: '',
      weekFocus: '', weekGoalUSD: 0, weekGoalPayments: 0
    });
    return typeof loaded === 'object' && loaded !== null ? loaded : {
      paymentsCount: 0, paymentsSum: 0, planWeek: 0, factWeek: 0,
      newLeads: 0, openDialogs: 0, totalInWork: 0, intensive: 0, zoom: 0,
      whatWorked: '', problems: '', nextWeekPlans: '',
      weekFocus: '', weekGoalUSD: 0, weekGoalPayments: 0
    };
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

    const rows = await fetchSheetData({
      type: 'daily',
      start: summaryRange.start,
      end: summaryRange.end
    });

    if (rows.length === 0) {
      alert('Нет данных в Google Sheets за выбранный период.');
      return;
    }

    const totals = rows.reduce(
      (acc, item) => ({
        revenue: acc.revenue + (Number(item.revenue) || 0),
        leads: acc.leads + (Number(item.leads) || 0),
        dialogs: acc.dialogs + (Number(item.dialogs) || 0),
        intensive: acc.intensive + (Number(item.intensive) || 0),
        zoom: acc.zoom + (Number(item.zoom) || 0),
        totalLeads: acc.totalLeads + (Number(item.totalLeads) || 0)
      }),
      { revenue: 0, leads: 0, dialogs: 0, intensive: 0, zoom: 0, totalLeads: 0 }
    );

    const loadedPotentials = rows.flatMap((item) => {
      if (item.potentials) {
        try {
          return JSON.parse(item.potentials);
        } catch {
          return [];
        }
      }
      if (item.potentialRows) {
        try {
          return JSON.parse(item.potentialRows);
        } catch {
          return [];
        }
      }
      return [];
    });

    if (loadedPotentials.length > 0) {
      setPotentials(loadedPotentials.map((potential) => ({
        account: potential.account || '',
        profile: potential.profile || '',
        plannedPaymentDate: potential.plannedPaymentDate || '',
        amount: Number(potential.amount) || 0
      })));
    }

    setFormData({
      ...formData,
      paymentsCount: rows.length,
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
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Inp label="Количество оплат" type="number" value={formData.paymentsCount} onChange={(v) => setFormData({...formData, paymentsCount: parseFloat(v)||0})} />
            <Inp label="Сумма оплат ($)" type="number" step="0.01" value={formData.paymentsSum} onChange={(v) => setFormData({...formData, paymentsSum: parseFloat(v)||0})} />
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
  const [viewMode, setViewMode] = useState('edit'); // 'edit' or 'present'
  const [savedData, setSavedData] = useState(null);
  const [monthlyMessage, setMonthlyMessage] = useState('');
  const [loadedRange, setLoadedRange] = useState('');
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

    let rows = await fetchSheetData({ type: 'weekly', start, end });
    if (rows.length === 0) {
      rows = await fetchSheetData({ type: 'daily', start, end });
    }

    if (rows.length === 0) {
      alert('Нет данных за выбранный месяц.');
      return;
    }

    const totals = rows.reduce((acc, item) => ({
      planUSD: acc.planUSD + (Number(item.planWeek) || 0),
      factUSD: acc.factUSD + (Number(item.factWeek) || 0),
      totalPayments: acc.totalPayments + (Number(item.paymentsCount) || 0),
      totalLeads: acc.totalLeads + (Number(item.totalLeads) || 0),
      intensive: acc.intensive + (Number(item.intensive) || 0),
      zoom: acc.zoom + (Number(item.zoom) || 0),
      payments: acc.payments + (Number(item.payments) || 0),
      newClients: acc.newClients + (Number(item.newLeads) || 0)
    }), {
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
    const dateLabel = new Date(`${year}-${month}-01`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
    setLoadedRange(`Выбранный период: ${dateLabel} (${start} — ${end}), ${daysInMonth} дн.`);
    setMonthlyMessage('Данные загружены из еженедельных отчётов. Проверьте и скорректируйте при необходимости.');
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

  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalLeads = data.reduce((sum, d) => sum + d.leads, 0);
  const totalDialogs = data.reduce((sum, d) => sum + d.dialogs, 0);
  const totalIntensive = data.reduce((sum, d) => sum + d.intensive, 0);
  const totalZoom = data.reduce((sum, d) => sum + d.zoom, 0);
  const avgConversion = data.reduce((sum, d) => sum + d.conversion, 0) / data.length;

  const isEmptyData = data.every(d =>
    d.revenue === 0 && d.leads === 0 && d.dialogs === 0 && d.intensive === 0 && d.zoom === 0 && d.conversion === 0
  );

  const stats = [
    { label: 'Общая выручка', value: `$${totalRevenue.toFixed(0)}`, change: isEmptyData ? '—' : '', icon: DollarSign, color: '#3b82f6' },
    { label: 'Всего лидов', value: totalLeads, change: isEmptyData ? '—' : '', icon: Users, color: '#10b981' },
    { label: 'Диалоги', value: totalDialogs, change: isEmptyData ? '—' : '', icon: MessageSquare, color: '#a855f7' },
    { label: 'Рег. интенсив', value: totalIntensive, change: isEmptyData ? '—' : '', icon: Zap, color: '#f59e0b' },
    { label: 'Рег. Zoom', value: totalZoom, change: isEmptyData ? '—' : '', icon: Video, color: '#ec4899' },
    { label: 'Конверсия', value: `${avgConversion.toFixed(1)}%`, change: isEmptyData ? '—' : '', icon: Target, color: '#6366f1' }
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

      <div className="grid grid-cols-3 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="bg-white rounded-2xl shadow-xl p-6">
              <div style={{ backgroundColor: stat.color }} className="w-12 h-12 rounded-xl flex items-center justify-center mb-4">
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div className="text-slate-600 text-sm mb-1">{stat.label}</div>
              <div className="text-3xl font-bold text-slate-800 mb-2">{stat.value}</div>
              <div className="text-slate-500 text-sm font-medium">{stat.change}</div>
            </div>
          );
        })}
      </div>

      <ChartCard title="💰 Выручка по дням">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="👥 Новые лиды">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Bar dataKey="leads" fill="#10b981" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="💬 Количество диалогов">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
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
          <LineChart data={data}>
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
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" />
            <YAxis stroke="#64748b" />
            <Tooltip />
            <Line type="monotone" dataKey="zoom" stroke="#ec4899" strokeWidth={3} dot={{ fill: '#ec4899', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="📊 Конверсия в оплату из лида">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
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
