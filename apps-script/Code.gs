/**
 * RekodSurat - Gmail -> Drive -> Google Sheets automation
 *
 * This script is intentionally independent from your existing Gmail sorter.
 * Configure GMAIL_QUERY to target the label/query your sorter already produces.
 * One row is created for every unique PDF attachment.
 */

const RS = {
  SHEET_ID: '1oQ-12HmR1AfWTMhKYF0jbFFIPKx-Gz1-oHPETopEDXg',
  INBOX_SHEET: 'Surat Masuk',
  FILE_SHEET: 'Rekod Fail',
  PROCESSED_LABEL: 'RekodSurat/Processed',
  DEFAULT_QUERY: 'has:attachment filename:pdf newer_than:30d',
  MAX_THREADS_PER_RUN: 35,
  FAIL_LIST_URL: 'https://raw.githubusercontent.com/farshoffs/rekodsuratfail/main/web/data/fail-list.json.gz.b64',
  HEADERS: [
    'ID','Tarikh Terima','Nama Surat','Pengirim','Tarikh Surat','Rujukan Surat',
    'Kod Fail','Nama Fail','Di Minit Kepada','Status','AI Cadangan Kod','AI Cadangan Nama',
    'AI Keyakinan','Ringkasan','Gmail Message ID','Gmail Thread ID','Drive File ID','Nama PDF',
    'Drive URL','Gmail URL','Disahkan Oleh','Tarikh Disahkan','Dicipta Pada','Last Update'
  ]
};

/** Run once after pasting the project. Safe to run again. */
function setupRekodSurat() {
  ensureSheets_();
  ensureDriveFolder_();
  syncRekodFail();
  ensureProcessedLabel_();
  installTrigger_();
  Logger.log('RekodSurat setup complete.');
}

/** Main recurring job. */
function scanInbox() {
  ensureSheets_();
  const props = PropertiesService.getScriptProperties();
  const query = props.getProperty('GMAIL_QUERY') || RS.DEFAULT_QUERY;
  const fullQuery = `${query} -label:${quoteLabel_(RS.PROCESSED_LABEL)}`;
  const threads = GmailApp.search(fullQuery, 0, RS.MAX_THREADS_PER_RUN);
  const processedLabel = ensureProcessedLabel_();
  const sheet = SpreadsheetApp.openById(RS.SHEET_ID).getSheetByName(RS.INBOX_SHEET);
  const known = existingKeys_(sheet);
  const folder = ensureDriveFolder_();

  threads.forEach(thread => {
    let threadHadPdf = false;
    thread.getMessages().forEach(message => {
      const pdfs = message.getAttachments({includeInlineImages:false, includeAttachments:true})
        .filter(a => a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()));
      if (!pdfs.length) return;
      threadHadPdf = true;
      pdfs.forEach(attachment => {
        const key = `${message.getId()}::${attachment.getName()}::${attachment.getBytes().length}`;
        if (known.has(key)) return;
        const record = buildRecord_(thread, message, attachment, folder, key);
        sheet.appendRow(record);
        known.add(key);
      });
    });
    if (threadHadPdf) thread.addLabel(processedLabel);
  });
}

/** Synchronise the 908-file master list generated from your Rekod Fail document. */
function syncRekodFail() {
  const ss = SpreadsheetApp.openById(RS.SHEET_ID);
  const sheet = getOrCreateSheet_(ss, RS.FILE_SHEET);
  const response = UrlFetchApp.fetch(RS.FAIL_LIST_URL, {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error('Gagal memuat turun master Rekod Fail dari GitHub.');
  const encoded = response.getContentText().trim();
  const gzipBlob = Utilities.newBlob(Utilities.base64Decode(encoded));
  const decoded = Utilities.ungzip(gzipBlob).getDataAsString('UTF-8');
  const rows = JSON.parse(decoded).map(x => [x.kod, x.nama, x.status]);
  sheet.clearContents();
  sheet.getRange(1,1,1,3).setValues([['Kod Fail','Nama Fail','Status Fail']]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2,1,rows.length,3).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,3);
}

/** Optional one-off helper: set a Gmail query matching your existing sorter. */
function setGmailQuery(query) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_QUERY', query);
}

/** Optional one-off helper: configure Gemini API. Never hard-code keys in this file. */
function setGeminiConfig(apiKey, model) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('GEMINI_API_KEY', apiKey);
  if (model) props.setProperty('GEMINI_MODEL', model);
}

function buildRecord_(thread, message, attachment, folder, uniqueKey) {
  const file = savePdf_(folder, attachment, message);
  const subject = cleanSubject_(message.getSubject() || attachment.getName());
  const sender = message.getFrom() || '';
  const received = message.getDate();
  const candidates = rankFileCandidates_(subject + ' ' + stripHtml_(message.getBody() || ''), 24);
  const ai = extractWithGemini_(attachment, {subject, sender, received, candidates});
  const now = new Date();
  const gmailUrl = `https://mail.google.com/mail/u/0/#all/${thread.getId()}`;
  return [
    uniqueKey,
    received,
    subject,
    sender,
    ai.tarikhSurat || '',
    ai.rujukanSurat || '',
    '',
    '',
    '',
    'PERLU_SEMAKAN',
    ai.kodFail || '',
    ai.namaFail || '',
    ai.keyakinan || '',
    ai.ringkasan || '',
    message.getId(),
    thread.getId(),
    file.getId(),
    attachment.getName(),
    file.getUrl(),
    gmailUrl,
    '',
    '',
    now,
    now
  ];
}

function savePdf_(folder, attachment, message) {
  const date = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const safeSubject = cleanSubject_(message.getSubject() || 'Surat').replace(/[\\/:*?"<>|]/g, '-').slice(0,90);
  const safeName = attachment.getName().replace(/[\\/:*?"<>|]/g, '-').slice(-100);
  return folder.createFile(attachment.copyBlob()).setName(`${date} - ${safeSubject} - ${safeName}`);
}

function extractWithGemini_(attachment, meta) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) return fallbackAi_(meta.candidates);
  const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  if (attachment.getBytes().length > 14 * 1024 * 1024) return fallbackAi_(meta.candidates);
  const candidateText = meta.candidates.map(x => `${x.kod} | ${x.nama}`).join('\n');
  const prompt = `Anda membantu pengurusan surat rasmi sekolah Malaysia. Analisis PDF ini.
Pulangkan JSON SAHAJA tanpa markdown dengan struktur:
{"tarikhSurat":"YYYY-MM-DD atau kosong","rujukanSurat":"nombor rujukan surat atau kosong","kodFail":"kod terbaik daripada senarai calon atau kosong","namaFail":"nama fail sepadan","keyakinan":"0-100","ringkasan":"maksimum 35 patah perkataan"}

Tajuk emel: ${meta.subject}
Pengirim: ${meta.sender}
Tarikh terima: ${meta.received.toISOString()}

Pilih kod fail HANYA daripada calon berikut. Jika tidak pasti, biarkan kodFail kosong:
${candidateText}`;
  const body = {
    contents: [{parts: [
      {text: prompt},
      {inline_data: {mime_type:'application/pdf', data: Utilities.base64Encode(attachment.getBytes())}}
    ]}],
    generationConfig: {responseMimeType:'application/json', temperature:0.1}
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true});
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return fallbackAi_(meta.candidates);
    const parsed = JSON.parse(res.getContentText());
    const text = parsed?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}';
    const data = safeJson_(text);
    const exact = meta.candidates.find(x => x.kod === data.kodFail);
    return {
      tarikhSurat: normalizeDate_(data.tarikhSurat),
      rujukanSurat: String(data.rujukanSurat || '').trim(),
      kodFail: exact ? exact.kod : '',
      namaFail: exact ? exact.nama : '',
      keyakinan: exact ? String(data.keyakinan || '') : '',
      ringkasan: String(data.ringkasan || '').trim()
    };
  } catch (err) {
    console.warn('Gemini failed', err);
    return fallbackAi_(meta.candidates);
  }
}

function fallbackAi_(candidates) {
  const best = candidates[0];
  return best && best.score >= 10
    ? {kodFail:best.kod, namaFail:best.nama, keyakinan:'heuristik', tarikhSurat:'', rujukanSurat:'', ringkasan:''}
    : {kodFail:'', namaFail:'', keyakinan:'', tarikhSurat:'', rujukanSurat:'', ringkasan:''};
}

function rankFileCandidates_(text, limit) {
  const sheet = SpreadsheetApp.openById(RS.SHEET_ID).getSheetByName(RS.FILE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,3).getValues();
  const src = normalizeText_(text);
  const tokens = [...new Set(src.split(/\s+/).filter(t => t.length >= 4))];
  return values.map(([kod,nama,status]) => {
    const target = normalizeText_(`${kod} ${nama}`);
    let score = tokens.reduce((n,t) => n + (target.includes(t) ? Math.min(t.length,10) : 0), 0);
    if (String(status).toLowerCase() === 'buka') score += 3;
    return {kod:String(kod), nama:String(nama), status:String(status), score};
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, limit || 20);
}

function ensureSheets_() {
  const ss = SpreadsheetApp.openById(RS.SHEET_ID);
  const inbox = getOrCreateSheet_(ss, RS.INBOX_SHEET);
  if (inbox.getLastRow() === 0) inbox.getRange(1,1,1,RS.HEADERS.length).setValues([RS.HEADERS]);
  else {
    const current = inbox.getRange(1,1,1,Math.max(inbox.getLastColumn(),RS.HEADERS.length)).getValues()[0];
    const missing = RS.HEADERS.some((h,i) => current[i] !== h);
    if (missing && inbox.getLastRow() === 1) inbox.getRange(1,1,1,RS.HEADERS.length).setValues([RS.HEADERS]);
  }
  inbox.setFrozenRows(1);
  const fileSheet = getOrCreateSheet_(ss, RS.FILE_SHEET);
  if (fileSheet.getLastRow() === 0) fileSheet.getRange(1,1,1,3).setValues([['Kod Fail','Nama Fail','Status Fail']]);
}

function existingKeys_(sheet) {
  if (sheet.getLastRow() < 2) return new Set();
  return new Set(sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues().flat().filter(Boolean));
}

function getOrCreateSheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function ensureProcessedLabel_() { return GmailApp.getUserLabelByName(RS.PROCESSED_LABEL) || GmailApp.createLabel(RS.PROCESSED_LABEL); }
function quoteLabel_(label) { return `"${label.replace(/"/g,'')}"`; }

function ensureDriveFolder_() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('PDF_FOLDER_ID');
  if (existing) {
    try { return DriveApp.getFolderById(existing); } catch (_) {}
  }
  const folder = DriveApp.createFolder('RekodSurat - PDF Surat Masuk');
  props.setProperty('PDF_FOLDER_ID', folder.getId());
  return folder;
}

function installTrigger_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'scanInbox').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scanInbox').timeBased().everyMinutes(5).create();
}

function cleanSubject_(s) { return String(s || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i,'').trim(); }
function stripHtml_(s) { return String(s || '').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim(); }
function normalizeText_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9/]+/g,' ').replace(/\s+/g,' ').trim(); }
function safeJson_(text) { const cleaned = String(text || '').replace(/^```json/i,'').replace(/```$/,'').trim(); try { return JSON.parse(cleaned); } catch (_) { const m = cleaned.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; } }
function normalizeDate_(v) { if (!v) return ''; const s = String(v).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
