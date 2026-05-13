// APCrypto CRM — Google Apps Script
// Вставь этот код в script.google.com и задеплой как Web App:
// Execute as: Me | Who has access: Anyone

const SPREADSHEET_ID = '14sOJxoFt0z3xvjStEt3vHAqJtHg_xudP3qwgBhyf7bM'; // ID твоей таблицы оплат
// Или создай новую таблицу и вставь её ID сюда

function doGet(e) {
  try {
    const action = (e.parameter.action || '').toString();

    if (action === 'save') {
      const data = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      saveReport(data);
      return jsonResponse({ status: 'ok' });
    }

    const type  = (e.parameter.type  || 'daily').toString();
    const start = (e.parameter.start || '').toString();
    const end   = (e.parameter.end   || '').toString();

    const rows = getReports(type, start, end);
    return jsonResponse(rows);
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    let data = {};
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    }
    saveReport(data);
    return jsonResponse({ status: 'ok' });
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ─── Чтение данных ──────────────────────────────────────────────────────────

function getReports(type, start, end) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name  = sheetName(type);
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const row = {};
    headers.forEach((h, j) => { row[h] = values[i][j]; });

    const date = (row.reportDate || row.date || '').toString();
    if (start && date < start) continue;
    if (end   && date > end)   continue;

    rows.push(row);
  }
  return rows;
}

// ─── Запись данных ───────────────────────────────────────────────────────────

function saveReport(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const type  = (data.type || 'daily').toString();
  const name  = sheetName(type);
  let sheet   = ss.getSheetByName(name);

  const cols  = columns(type);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  }

  // Убедимся что заголовки на месте
  const existingHeader = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
  if (!existingHeader[0]) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  }

  const row = cols.map(col => {
    const v = data[col];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });

  sheet.appendRow(row);
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

function sheetName(type) {
  if (type === 'weekly')  return 'CRM_Weekly';
  if (type === 'monthly') return 'CRM_Monthly';
  return 'CRM_Daily';
}

function columns(type) {
  if (type === 'weekly') return [
    'timestamp','reportDate','type',
    'paymentsCount','paymentsSum','planWeek','factWeek',
    'newLeads','openDialogs','totalInWork','intensive','zoom',
    'whatWorked','problems','nextWeekPlans','weekFocus','weekGoalUSD','weekGoalPayments'
  ];
  if (type === 'monthly') return [
    'timestamp','reportDate','type','reportMonth',
    'planUSD','factUSD','totalPayments','totalLeads',
    'intensive','zoom','payments','newClients','recurring'
  ];
  // daily — по умолчанию
  return [
    'timestamp','reportDate','type','section',
    'totalUSD','totalCount',
    'rateUSD','rateEUR','rateUSDT',
    'countUSD','sumUSD','countUSDT','sumUSDT',
    'countRUB','sumRUB','countEUR','sumEUR',
    'newLeads','dialogs','totalLeads','intensive','zoom','notes'
  ];
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
