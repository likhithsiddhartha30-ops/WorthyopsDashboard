// ── WorthyOps Dashboard — Google Apps Script Backend ─────────
// Paste this entire file into your Google Apps Script editor.
// Sheet ID is already set to your spreadsheet.

var SS = SpreadsheetApp.openById('11AxOqVmewXWHcC6r9Dy7c_H38zQG50CjADvutJoz5sw');

function doGet(e) {
  var p      = e.parameter;
  var action = p.action || '';
  var data   = p.payload ? JSON.parse(p.payload) : {};
  var result;

  try {
    switch (action) {
      case 'getUsers':     result = sheetRows('Users');            break;
      case 'getClients':   result = sheetRows('Clients');          break;
      case 'getDeals':     result = sheetRows(p.clientName || ''); break;
      case 'addClient':    result = addClient(data);               break;
      case 'addDeals':     result = addDeals(data);                break;
      case 'deleteClient': result = deleteClient(data);            break;
      case 'deleteDeal':   result = deleteDeal(data);              break;
      case 'setGoal':      result = setGoal(data);                 break;
      default:             result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  var json     = JSON.stringify(result);
  var callback = p.callback || '';
  var body     = callback ? callback + '(' + json + ')' : json;
  var mime     = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mime);
}

// ── SHEET HELPERS ─────────────────────────────────────────────

function sheetRows(name) {
  var sheet = SS.getSheetByName(name);
  if (!sheet) return [];
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0].map(String);
  return vals.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      obj[h] = (row[i] !== undefined && row[i] !== null) ? String(row[i]) : '';
    });
    return obj;
  });
}

function clientSheet(name) {
  var s = SS.getSheetByName(name);
  if (!s) {
    s = SS.insertSheet(name);
    s.appendRow(['id', 'name', 'value', 'status', 'date', 'notes', 'contact', 'addedAt']);
  }
  return s;
}

function removeRows(sheetName, colName, value) {
  var sheet = SS.getSheetByName(sheetName);
  if (!sheet) return;
  var vals         = sheet.getDataRange().getValues();
  var headers      = vals[0].map(String);
  var lowerHeaders = headers.map(function(h) { return h.toLowerCase(); });
  var colIdx       = lowerHeaders.indexOf(colName.toLowerCase());
  if (colIdx < 0) return;
  for (var i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][colIdx]) === String(value)) sheet.deleteRow(i + 1);
  }
}

// ── ACTIONS ───────────────────────────────────────────────────

function addClient(p) {
  SS.getSheetByName('Clients').appendRow([p.id, p.name, p.email]);
  SS.getSheetByName('Users').appendRow([p.userId, p.name, p.email, p.password, 'client', p.id]);
  clientSheet(p.name);
  return { ok: true };
}

function addDeals(p) {
  var sheet = clientSheet(p.clientName);
  p.deals.forEach(function(d) {
    sheet.appendRow([
      d.id, d.name, d.value, d.status,
      d.date || '', d.notes || '', d.contact || '',
      d.addedAt || new Date().toISOString()
    ]);
  });
  return { ok: true };
}

function deleteClient(p) {
  removeRows('Clients', 'id', p.clientId);
  removeRows('Users', 'clientId', p.clientId);
  var s = SS.getSheetByName(p.clientName);
  if (s) SS.deleteSheet(s);
  return { ok: true };
}

function deleteDeal(p) {
  removeRows(p.clientName, 'id', p.dealId);
  return { ok: true };
}

function setGoal(p) {
  var sheet = SS.getSheetByName('Clients');
  if (!sheet) return { error: 'Clients sheet not found' };
  var vals         = sheet.getDataRange().getValues();
  var headers      = vals[0].map(String);
  var lowerHeaders = headers.map(function(h) { return h.toLowerCase(); });

  var idCol = lowerHeaders.indexOf('id');
  if (idCol < 0) return { error: 'id column not found' };

  // Build month-specific header e.g. "Goal(May)"
  var monthNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var month       = p.month || monthNames[new Date().getMonth()];
  var goalHeader  = 'Goal(' + month + ')';
  var goalLower   = goalHeader.toLowerCase();

  var goalCol = lowerHeaders.indexOf(goalLower);
  if (goalCol < 0) {
    goalCol = headers.length;
    sheet.getRange(1, goalCol + 1).setValue(goalHeader);
  }

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][idCol]) === String(p.clientId)) {
      sheet.getRange(i + 1, goalCol + 1).setValue(p.goal);
      return { ok: true };
    }
  }
  return { error: 'Client not found — id: ' + p.clientId };
}
