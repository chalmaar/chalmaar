/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CSN BOOKINGS — Google Apps Script webhook v3
 *  Manages 3 tabs: Bookings_Payments, Gate_Passes, Event_Config
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ACTIONS:
 *    append         — add a booking row to Bookings_Payments (Status=PENDING)
 *    checkUtr       — UTR replay protection
 *    update         — update a booking (status / passFileId / screenshotUrl)
 *                     when status=APPROVED, also syncs to Gate_Passes
 *                     when status=REJECTED, removes from Gate_Passes
 *    list           — list all bookings (admin view)
 *    getBooking     — fetch one booking by ID (gate validation)
 *    getEventConfig — read all key-value pairs from Event_Config tab
 *    updateEventConfig — write key-value pairs to Event_Config tab
 *    addPoster      — append a poster URL to the posters list in Event_Config
 *    removePoster   — remove a poster URL from the posters list
 *
 *  SETUP:
 *    1. Open your Google Sheet → Extensions → Apps Script
 *    2. Select all → delete → paste this file
 *    3. Deploy → New deployment → Web app →
 *         Execute as: Me, Who has access: Anyone
 *    4. Copy the /exec URL → set as APPS_SCRIPT_WEBHOOK_URL in .env
 *
 *  OPTIONAL SHARED SECRET:
 *    Project Settings → Script properties →
 *    Name: SHARED_SECRET, Value: any random string
 *    Set the same value as APPS_SCRIPT_SECRET in .env
 */

// ─── Tab names ─────────────────────────────────────────────────────────────
const TAB_BOOKINGS = 'Bookings_Payments';
const TAB_GATE     = 'Gate_Passes';
const TAB_CONFIG  = 'Event_Config';

// ─── Bookings_Payments columns (1-indexed for sheet.getRange) ──────────────
const BOOKING_COLS = [
  'Timestamp', 'Booking ID', 'Name', 'Phone', 'Pass Tier',
  'Quantity', 'Expected Amount', 'UTR', 'Screenshot URL',
  'Status', 'Approved At', 'Pass File ID', 'Checked In', 'Checked In At',
];
// 1=Timestamp, 2=Booking ID, 3=Name, 4=Phone, 5=Pass Tier, 6=Quantity,
// 7=Expected Amount, 8=UTR, 9=Screenshot URL, 10=Status, 11=Approved At,
// 12=Pass File ID, 13=Checked In, 14=Checked In At

// ─── Gate_Passes columns (subset focused on gate staff / AppSheet) ─────────
const GATE_COLS = [
  'Booking ID', 'Name', 'Phone', 'Pass Tier', 'Quantity',
  'Status', 'Pass File ID', 'Checked In', 'Checked In At',
];

// ─── Event_Config: simple key-value layout ──────────────────────────────────
//   Column A = Key, Column B = Value
//   e.g.  title | DIWALI PARTY — Featuring Sudhanshu & Maryana
//         date  | 2026-11-07
//         prices | Female Pass:999,Male Pass:2499,Couple Pass:2999,...

// ═══════════════════════════════════════════════════════════════════════════
//  Bootstrap: ensure all 3 tabs + headers exist
// ═══════════════════════════════════════════════════════════════════════════
function ensureAllSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheets().map(function (s) { return s.getName(); });

  // Bookings_Payments
  let bookings = ss.getSheetByName(TAB_BOOKINGS);
  if (!bookings) {
    bookings = ss.insertSheet(TAB_BOOKINGS);
    bookings.getRange(1, 1, 1, BOOKING_COLS.length).setValues([BOOKING_COLS]);
    bookings.getRange(1, 1, 1, BOOKING_COLS.length).setFontWeight('bold');
    bookings.setFrozenRows(1);
  } else {
    ensureHeader_(bookings, BOOKING_COLS);
  }

  // Gate_Passes
  let gate = ss.getSheetByName(TAB_GATE);
  if (!gate) {
    gate = ss.insertSheet(TAB_GATE);
    gate.getRange(1, 1, 1, GATE_COLS.length).setValues([GATE_COLS]);
    gate.getRange(1, 1, 1, GATE_COLS.length).setFontWeight('bold');
    gate.setFrozenRows(1);
  } else {
    ensureHeader_(gate, GATE_COLS);
  }

  // Event_Config — only seed defaults if tab is brand-new
  let config = ss.getSheetByName(TAB_CONFIG);
  const configExisted = existing.indexOf(TAB_CONFIG) !== -1;
  if (!config) {
    config = ss.insertSheet(TAB_CONFIG);
    config.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    config.getRange(1, 1, 1, 2).setFontWeight('bold');
    config.setFrozenRows(1);
    // Seed defaults (the website will use these if not overridden by Telegram admin)
    seedDefaultConfig_(config);
  }
  return { bookings: bookings, gate: gate, config: config };
}

function ensureHeader_(sheet, cols) {
  const header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
  const matches = header.length === cols.length && header.every(function (c, i) { return c === cols[i]; });
  if (!matches) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function seedDefaultConfig_(sheet) {
  const defaults = [
    ['active', 'true'],
    ['title', 'DIWALI PARTY — Featuring Sudhanshu & Maryana'],
    ['date', '2026-11-07'],
    ['time', '5:00 PM Onwards'],
    ['venue', 'TERRA Plates and Pour, Near Prozone Mall, Chh. Sambhajinagar'],
    ['description', 'The biggest Diwali night in Chh. Sambhajinagar. Sudhanshu & Maryana headlining a high-energy set at TERRA. Pass tiers for every kind of night-owl — female, male, couple, and exclusive standing / seating tables.'],
    ['phone1', '9923973380'],
    ['phone2', '8180044118'],
    ['prices', 'Female Pass:999,Male Pass:2499,Couple Pass:2999,Standing Table:20000,Seating Table:30000'],
    ['upiId', '9359248812@ybl'],
    ['upiPayeeName', 'CSN Signature Events'],
    ['posters', 'poster-1-group.jpeg,poster-2-maryana.jpeg,poster-3-sudhanshu.jpeg,poster-4-passes-live.jpeg,poster-5-pass-rates.jpeg,poster-6-table-rates.jpeg'],
  ];
  sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Booking operations
// ═══════════════════════════════════════════════════════════════════════════
function appendBooking_(data) {
  const sheets = ensureAllSheets_();
  const row = [
    new Date(),                                    // 1 Timestamp
    data.bookingId || '',                          // 2 Booking ID
    data.name || '',                               // 3 Name
    data.phone || '',                              // 4 Phone
    data.passTier || '',                           // 5 Pass Tier
    data.quantity || '',                           // 6 Quantity
    data.expectedAmount || '',                     // 7 Expected Amount
    data.utr || '',                                // 8 UTR
    data.screenshotUrl || '',                      // 9 Screenshot URL
    data.status || 'PENDING',                      // 10 Status
    '',                                            // 11 Approved At
    '',                                            // 12 Pass File ID
    'FALSE',                                       // 13 Checked In
    '',                                            // 14 Checked In At
  ];
  sheets.bookings.appendRow(row);
  return row;
}

function isUtrUsed_(utr) {
  if (!utr) return false;
  const sheets = ensureAllSheets_();
  const lastRow = sheets.bookings.getLastRow();
  if (lastRow < 2) return false;
  const utrCol = sheets.bookings.getRange(2, 8, lastRow - 1, 1).getValues(); // col 8 = UTR
  for (let i = 0; i < utrCol.length; i++) {
    if (String(utrCol[i][0]) === String(utr)) return true;
  }
  return false;
}

function findBookingRow_(bookingId) {
  const sheets = ensureAllSheets_();
  const lastRow = sheets.bookings.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheets.bookings.getRange(2, 2, lastRow - 1, 1).getValues(); // col 2 = Booking ID
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(bookingId)) return i + 2; // 1-indexed + header
  }
  return -1;
}

function getBookingById_(bookingId) {
  const rowIndex = findBookingRow_(bookingId);
  if (rowIndex === -1) return null;
  const sheets = ensureAllSheets_();
  const row = sheets.bookings.getRange(rowIndex, 1, 1, BOOKING_COLS.length).getValues()[0];
  return rowToBooking_(row);
}

function rowToBooking_(row) {
  return {
    timestamp:      row[0]  instanceof Date ? row[0].toISOString() : String(row[0]),
    bookingId:      row[1],
    name:           row[2],
    phone:          String(row[3]),
    passTier:       row[4],
    quantity:       row[5],
    expectedAmount: row[6],
    utr:            String(row[7]),
    screenshotUrl:  row[8],
    status:         row[9],
    approvedAt:     row[10] instanceof Date ? row[10].toISOString() : String(row[10]),
    passFileId:     row[11],
    checkedIn:      String(row[12]),
    checkedInAt:    row[13] instanceof Date ? row[13].toISOString() : String(row[13]),
  };
}

function getAllBookings_() {
  const sheets = ensureAllSheets_();
  const lastRow = sheets.bookings.getLastRow();
  if (lastRow < 2) return [];
  const values = sheets.bookings.getRange(2, 1, lastRow - 1, BOOKING_COLS.length).getValues();
  return values
    .map(rowToBooking_)
    .filter(function (b) { return b.bookingId; })
    .sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); });
}

// ─── update action: status / passFileId / screenshotUrl / checkedIn ────────
// When status flips to APPROVED → also append/update a row in Gate_Passes
// When status flips to REJECTED → remove the row from Gate_Passes
// When checkedIn=TRUE → also set Checked In At = now, sync to Gate_Passes
function updateBooking_(data) {
  if (!data.bookingId) return { ok: false, error: 'MISSING_BOOKING_ID' };
  const rowIndex = findBookingRow_(data.bookingId);
  if (rowIndex === -1) return { ok: false, error: 'BOOKING_NOT_FOUND' };

  const sheets = ensureAllSheets_();
  const previousRow = sheets.bookings.getRange(rowIndex, 1, 1, BOOKING_COLS.length).getValues()[0];
  const prevStatus = previousRow[9];

  // Apply field updates
  //   col 9  = Screenshot URL
  //   col 10 = Status
  //   col 11 = Approved At
  //   col 12 = Pass File ID
  //   col 13 = Checked In
  //   col 14 = Checked In At
  if (data.screenshotUrl) sheets.bookings.getRange(rowIndex, 9).setValue(data.screenshotUrl);
  if (data.status)        sheets.bookings.getRange(rowIndex, 10).setValue(data.status);
  if (data.passFileId)    sheets.bookings.getRange(rowIndex, 12).setValue(data.passFileId);
  if (data.checkedIn === 'TRUE' || data.checkedIn === true || data.checkedIn === 'FALSE' || data.checkedIn === false) {
    const val = (data.checkedIn === 'TRUE' || data.checkedIn === true) ? 'TRUE' : 'FALSE';
    sheets.bookings.getRange(rowIndex, 13).setValue(val);
    if (val === 'TRUE') {
      sheets.bookings.getRange(rowIndex, 14).setValue(new Date()); // Checked In At
    }
  }

  // Status transition side-effects
  if (data.status === 'APPROVED' && prevStatus !== 'APPROVED') {
    sheets.bookings.getRange(rowIndex, 11).setValue(new Date()); // Approved At
    upsertGatePass_(sheets.gate, data.bookingId);
  } else if (data.status === 'REJECTED') {
    removeGatePass_(sheets.gate, data.bookingId);
  } else {
    // Status unchanged — still sync to Gate_Passes if there are other updates
    // (e.g., checkedIn toggle on an already-APPROVED booking).
    upsertGatePass_(sheets.gate, data.bookingId);
  }

  return { ok: true, bookingId: data.bookingId };
}

function upsertGatePass_(gateSheet, bookingId) {
  // Find the booking's latest row (we just updated it)
  const rowIndex = findBookingRow_(bookingId);
  if (rowIndex === -1) return;
  const sheets = ensureAllSheets_();
  const row = sheets.bookings.getRange(rowIndex, 1, 1, BOOKING_COLS.length).getValues()[0];
  const gateRow = [
    row[1],  // Booking ID
    row[2],  // Name
    String(row[3]),  // Phone
    row[4],  // Pass Tier
    row[5],  // Quantity
    row[9],  // Status
    row[11], // Pass File ID
    row[12], // Checked In
    row[13], // Checked In At
  ];

  // Find existing gate row by Booking ID (col 1)
  const lastGateRow = gateSheet.getLastRow();
  let gateRowIndex = -1;
  if (lastGateRow >= 2) {
    const gateIds = gateSheet.getRange(2, 1, lastGateRow - 1, 1).getValues();
    for (let i = 0; i < gateIds.length; i++) {
      if (String(gateIds[i][0]) === String(bookingId)) {
        gateRowIndex = i + 2;
        break;
      }
    }
  }
  if (gateRowIndex === -1) {
    gateSheet.appendRow(gateRow);
  } else {
    gateSheet.getRange(gateRowIndex, 1, 1, GATE_COLS.length).setValues([gateRow]);
  }
}

function removeGatePass_(gateSheet, bookingId) {
  const lastGateRow = gateSheet.getLastRow();
  if (lastGateRow < 2) return;
  const gateIds = gateSheet.getRange(2, 1, lastGateRow - 1, 1).getValues();
  for (let i = 0; i < gateIds.length; i++) {
    if (String(gateIds[i][0]) === String(bookingId)) {
      gateSheet.deleteRow(i + 2);
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Event_Config: key-value store
// ═══════════════════════════════════════════════════════════════════════════
function getEventConfig_() {
  const sheets = ensureAllSheets_();
  const lastRow = sheets.config.getLastRow();
  if (lastRow < 2) return {};
  const values = sheets.config.getRange(2, 1, lastRow - 1, 2).getValues();
  const cfg = {};
  for (let i = 0; i < values.length; i++) {
    const k = String(values[i][0]);
    const v = String(values[i][1]);
    if (k) cfg[k] = v;
  }
  // Special: parse prices into a map
  if (cfg.prices) {
    const priceMap = {};
    cfg.prices.split(',').forEach(function (pair) {
      const parts = pair.split(':');
      if (parts.length === 2) priceMap[parts[0].trim()] = parseInt(parts[1], 10);
    });
    cfg._prices = priceMap;
  }
  // Special: parse posters into an array
  if (cfg.posters) {
    cfg._posters = cfg.posters.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  }
  return cfg;
}

function updateEventConfig_(updates) {
  if (!updates || typeof updates !== 'object') return { ok: false, error: 'INVALID_UPDATES' };
  const sheets = ensureAllSheets_();
  const lastRow = sheets.config.getLastRow();

  // Build a key→rowIndex map
  const keyMap = {};
  if (lastRow >= 2) {
    const keys = sheets.config.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0])) keyMap[String(keys[i][0])] = i + 2;
    }
  }

  let nextRow = lastRow + 1;
  for (const key in updates) {
    if (key.startsWith('_')) continue; // skip computed keys
    const value = String(updates[key]);
    if (keyMap[key]) {
      sheets.config.getRange(keyMap[key], 2).setValue(value);
    } else {
      sheets.config.getRange(nextRow, 1, 1, 2).setValues([[key, value]]);
      keyMap[key] = nextRow;
      nextRow++;
    }
  }
  return { ok: true };
}

function addPoster_(url) {
  const cfg = getEventConfig_();
  const list = cfg._posters || [];
  if (list.indexOf(url) !== -1) return { ok: false, error: 'ALREADY_EXISTS' };
  list.push(url);
  return updateEventConfig_({ posters: list.join(',') });
}

function removePoster_(url) {
  const cfg = getEventConfig_();
  const list = cfg._posters || [];
  const idx = list.indexOf(url);
  if (idx === -1) return { ok: false, error: 'NOT_FOUND' };
  list.splice(idx, 1);
  return updateEventConfig_({ posters: list.join(',') });
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP handlers
// ═══════════════════════════════════════════════════════════════════════════
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSharedSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SHARED_SECRET') || '';
}

function authorize_(body) {
  const secret = getSharedSecret_();
  if (!secret) return true;
  return body.secret === secret;
}

function doGet() {
  return json_({
    ok: true,
    message: 'CSN webhook v3 is live. Actions: append | checkUtr | update | list | getBooking | getEventConfig | updateEventConfig | addPoster | removePoster.',
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (!authorize_(body)) return json_({ ok: false, error: 'UNAUTHORIZED' });

    switch (body.action) {
      case 'checkUtr':
        return json_({ ok: true, used: isUtrUsed_(body.utr) });

      case 'list':
        return json_({ ok: true, bookings: getAllBookings_() });

      case 'getBooking': {
        if (!body.bookingId) return json_({ ok: false, error: 'MISSING_BOOKING_ID' });
        const b = getBookingById_(body.bookingId);
        if (!b) return json_({ ok: false, error: 'BOOKING_NOT_FOUND' });
        return json_({ ok: true, booking: b });
      }

      case 'append': {
        if (!body.bookingId || !body.name || !body.phone ||
            !body.passTier || !body.quantity || !body.utr) {
          return json_({ ok: false, error: 'MISSING_FIELDS' });
        }
        if (isUtrUsed_(body.utr)) return json_({ ok: false, error: 'UTR_ALREADY_USED' });
        appendBooking_(body);
        return json_({ ok: true, bookingId: body.bookingId });
      }

      case 'update':
        return json_(updateBooking_(body));

      case 'getEventConfig':
        return json_({ ok: true, config: getEventConfig_() });

      case 'updateEventConfig':
        return json_(updateEventConfig_(body.updates || {}));

      case 'addPoster':
        return json_(addPoster_(body.url || ''));

      case 'removePoster':
        return json_(removePoster_(body.url || ''));

      default:
        return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
