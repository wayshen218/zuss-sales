/**
 * ZUSS Sales — Google Sheet backend (Apps Script web app)
 *
 * The Google Sheet this script is attached to is the database.
 * The phone app talks to this script through doPost (JSON in, JSON out).
 *
 * One-time setup: open the Sheet → menu "ZUSS" → "1. Set up sheet".
 * Deploy: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 *
 * Do not rename tabs or header cells; the app looks them up by name.
 */

var APP_VERSION = '1.5.0';
var SESSION_DAYS = 180;
var MAX_PIN_FAILS = 5;
var LOCKOUT_SECONDS = 600;

// Bump when SCHEMA gains tabs/columns: they are added automatically on the next request (data is never removed).
var SCHEMA_VERSION = 2;
var PHOTO_KINDS = { namecard: 'Name card', ssm: 'SSM', shop: 'Shop photo', other: 'Other' };

var HQ_STATUSES = ['Not submitted', 'Submitted', 'Processing', 'Fulfilled'];
var STAGES = ['New', 'Warm', 'Quoted', 'Follow-up', 'Won', 'Lost'];

// Column definitions. Type: s = text, n = number, b = true/false.
var SCHEMA = {
  Shops: [['id','s'],['name','s'],['contact','s'],['phone','s'],['address','s'],['area','s'],['state','s'],
    ['stage','s'],['stockist','b'],['follow_up','s'],['potential_value','n'],['notes','s'],
    ['lat','n'],['lng','n'],['pin_accuracy_m','n'],['pinned_at','s'],['pinned_by','s'],
    ['source','s'],['created_at','s'],['created_by','s'],['updated_at','s'],['updated_by','s'],['deleted','b']],
  Orders: [['id','s'],['order_no','s'],['shop_id','s'],['shop_name','s'],['contact','s'],['phone','s'],['address','s'],
    ['price_tier','s'],['status','s'],['hq_status','s'],['paid','b'],['commission_eligible','b'],
    ['cartons','n'],['pails','n'],['total','n'],['notes','s'],
    ['created_at','s'],['created_by','s'],['updated_at','s'],['updated_by','s'],['synced_at','s']],
  OrderItems: [['id','s'],['order_id','s'],['order_no','s'],['line_no','n'],['kind','s'],['product_id','s'],
    ['description','s'],['size','s'],['qty','n'],['bottles','n'],['unit_price','n'],['line_total','n'],['mix_detail','s']],
  OrderLog: [['id','s'],['order_id','s'],['order_no','s'],['at','s'],['by','s'],['event','s'],['detail','s'],['synced_at','s']],
  Visits: [['id','s'],['shop_id','s'],['shop_name','s'],['at','s'],['by','s'],['note','s'],['lat','n'],['lng','n'],['synced_at','s']],
  Products: [['id','s'],['name','s'],['grade','s'],['size','s'],['type','s'],['spec','s'],['pack','s'],['units_per_pack','n'],
    ['nonstockist_price','n'],['stockist_price','n'],['list_price','n'],['image','s'],['category','s'],['sort','n'],['active','b']],
  Checklist: [['id','s'],['date','s'],['user_id','s'],['done','s'],['decision_makers','n'],['notes','s'],['updated_at','s']],
  Favourites: [['user_id','s'],['shop_id','s']],
  Photos: [['id','s'],['shop_id','s'],['shop_name','s'],['kind','s'],['file_id','s'],['file_name','s'],['url','s'],['mime','s'],
    ['taken_at','s'],['by','s'],['deleted','b'],['synced_at','s']],
  Settings: [['key','s'],['value','s'],['note','s']],
  Users: [['user_id','s'],['name','s'],['role','s'],['can_hq','b'],['pin_hash','s'],['salt','s'],['active','b'],['created_at','s']],
  Sessions: [['token_hash','s'],['user_id','s'],['created_at','s'],['last_seen','s']]
};

var DEFAULT_SETTINGS = [
  ['initial_target', '25000', 'RM — first target, counted from start_date'],
  ['monthly_target', '300000', 'RM per calendar month'],
  ['commission_rate', '10', '% of order total (estimate only)'],
  ['start_date', '', 'YYYY-MM-DD. Blank = date of first order'],
  ['mixed_carton_enabled', 'TRUE', 'Allow mixed cartons (6 bottles of different products)'],
  ['mix_4l_5l_together', 'FALSE', 'Allow 4L and 5L bottles in the same mixed carton'],
  ['price_list_version', 'V2026-NR1', 'Shown in the app']
];

/* ───────────────────────── Sheet menu & setup ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ZUSS')
    .addItem('1. Set up sheet', 'setupSheet')
    .addItem('2. Add or reset a user PIN', 'addOrResetUser')
    .addSeparator()
    .addItem('Sign out all devices', 'signOutAllDevices')
    .addItem('Start fresh (clear test data)…', 'startFresh')
    .addSeparator()
    .addItem('Update script from GitHub…', 'updateScriptFromGitHub')
    .addItem('Roll back script…', 'rollbackScript')
    .addItem('Script version info', 'scriptVersionInfo')
    .addToUi();
}

function setupSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Kuala_Lumpur');
  var created = [];
  Object.keys(SCHEMA).forEach(function (name) {
    if (ensureSheet_(ss, name)) created.push(name);
  });
  var seeded = [];
  if (countRows_('Products') === 0) { seedProducts_(); seeded.push('Products (' + SEED_PRODUCTS.length + ')'); }
  if (countRows_('Shops') === 0) { seedShops_(); seeded.push('Shops (' + SEED_SHOPS.length + ')'); }
  PropertiesService.getScriptProperties().setProperty('schema_v', String(SCHEMA_VERSION));
  if (countRows_('Settings') === 0) { appendRows_('Settings', DEFAULT_SETTINGS.map(function (r) { return { key: r[0], value: r[1], note: r[2] }; })); seeded.push('Settings'); }
  hideSensitiveTabs_(ss);
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var msg = 'Setup complete.\n\n' +
    (created.length ? 'Tabs created: ' + created.join(', ') + '\n' : 'All tabs already existed.\n') +
    (seeded.length ? 'Data added: ' + seeded.join(', ') + '\n' : 'Existing data left untouched.\n');
  if (countRows_('Users') === 0) {
    msg += '\nNext: add the two users (you, then your brother).';
    ui.alert(msg);
    addOrResetUser(true);
    addOrResetUser(true);
  } else {
    ui.alert(msg);
  }
}

function addOrResetUser(fromSetup) {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('User name', 'Name used to log in (e.g. Shen). If the name exists, its PIN is reset.', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var name = String(r1.getResponseText() || '').trim();
  if (!name) { ui.alert('Name cannot be empty.'); return; }
  var r2 = ui.prompt('PIN for ' + name, 'Enter a 4–8 digit PIN.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var pin = String(r2.getResponseText() || '').trim();
  if (!/^\d{4,8}$/.test(pin)) { ui.alert('PIN must be 4–8 digits. Nothing was changed.'); return; }

  var t = table_('Users');
  var existing = t.rows.filter(function (u) { return norm_(u.name) === norm_(name); })[0];
  var salt = Utilities.getUuid();
  if (existing) {
    updateRow_(t, existing._row, { pin_hash: hash_(salt + pin), salt: salt, active: true });
    revokeSessionsFor_(existing.user_id);
    ui.alert('PIN reset for ' + existing.name + '. Their devices are signed out and must log in again.');
    return;
  }
  var r3 = ui.alert('Role for ' + name, 'Is ' + name + ' the admin (owner)?\n\nYES = admin (can change targets & settings)\nNO = salesman', ui.ButtonSet.YES_NO);
  var role = r3 === ui.Button.YES ? 'admin' : 'sales';
  var r4 = ui.alert('HQ status for ' + name, 'Can ' + name + ' update ZUSS HQ order status (Submitted / Processing / Fulfilled)?', ui.ButtonSet.YES_NO);
  appendRows_('Users', [{
    user_id: 'u-' + Utilities.getUuid().slice(0, 8), name: name, role: role, can_hq: r4 === ui.Button.YES,
    pin_hash: hash_(salt + pin), salt: salt, active: true, created_at: nowIso_()
  }]);
  ui.alert(name + ' added (' + role + (r4 === ui.Button.YES ? ', can update HQ status' : '') + ').');
}

// Wipes all activity (orders, check-ins, checklists, favourites) and resets the shop list to the
// original survey list. Users, PINs, products/prices and settings are kept. A full backup copy of
// the spreadsheet is saved in Google Drive first, so this can be undone.
function startFresh() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ok = ui.alert('Start fresh?',
    'This removes ALL orders, order items, order logs, check-ins, daily checklists, favourites and shop photos (photo files go to Drive Trash), ' +
    'and resets the shop list to the original ' + SEED_SHOPS.length + ' survey shops (shops added in the app, pins, follow-ups and stage changes are removed).\n\n' +
    'Kept: users & PINs, products & prices, settings.\n\nA backup copy of this spreadsheet is saved to your Google Drive first.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var r = ui.prompt('Confirm', 'Type RESET to confirm.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || String(r.getResponseText()).trim().toUpperCase() !== 'RESET') { ui.alert('Cancelled. Nothing was changed.'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('The app is saving something right now. Try again in a minute.'); return; }
  try {
    var backupName = ss.getName() + ' — backup before reset ' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm');
    ss.copy(backupName);
    ensureSchema_(true);
    ['Orders', 'OrderItems', 'OrderLog', 'Visits', 'Checklist', 'Favourites', 'Shops', 'Photos'].forEach(function (n) {
      var t = table_(n);
      if (t.rows.length) t.sheet.getRange(2, 1, t.sheet.getMaxRows() - 1, t.sheet.getMaxColumns()).clearContent();
      delete TABLE_CACHE_[n];
    });
    seedShops_();
    resetPhotoFolders_();
    SpreadsheetApp.flush();
    ui.alert('Done. Everything is fresh.\n\nBackup saved in your Google Drive as:\n"' + backupName + '"\n\nOn each phone, open the app: it refreshes on its own within a minute (or tap the sync pill at the top right → Sync now).');
  } finally {
    lock.releaseLock();
  }
}

// Run this once from the Apps Script editor after updating, so Google asks for the new permissions
// (Google Drive for photos, Maps for reading map links) and creates the new Photos tab.
function authorizeOnce() {
  DriveApp.getRootFolder();
  try { scriptApi_('/deployments'); } catch (e) { Logger.log('Self-update not ready yet: ' + e.message); }
  try { Maps.newGeocoder().geocode('Kota Bharu, Kelantan'); } catch (e) { /* not critical */ }
  ensureSchema_(true);
  Logger.log('All set: permissions granted and Sheet tabs up to date.');
}

/* ───────────────────────── Self-update from GitHub & rollback ─────────────────────────
 * The latest Code.gs lives in the GitHub repository (apps-script/Code.gs). "Update script from GitHub"
 * copies it into this project, saves it as a new numbered version and points the web app at it.
 * "Roll back script" points the web app (and the editor code) back at any earlier version.
 * Needs: Apps Script API turned on (script.google.com/home/usersettings) and the scopes in appsscript.json. */

var GITHUB_CODE_URL = 'https://raw.githubusercontent.com/wayshen218/zuss-sales/main/apps-script/Code.gs';

function scriptApi_(path, method, body) {
  var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + path, {
    method: method || 'get', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) {
    if (/has not been used|is disabled|SERVICE_DISABLED|User has not enabled the Apps Script API/i.test(text)) {
      throw new Error('The Apps Script API is off. Open script.google.com/home/usersettings, switch "Google Apps Script API" ON, wait 1 minute and try again.');
    }
    if (code === 403 && /scope|insufficient/i.test(text)) throw new Error('Missing permission. Make sure appsscript.json has the scopes from the setup guide, then run authorizeOnce.');
    throw new Error('Google Apps Script API error ' + code + ': ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}

function webAppDeployments_() {
  var list = (scriptApi_('/deployments').deployments || []);
  return list.filter(function (d) {
    var cfg = d.deploymentConfig || {};
    var isWeb = (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; });
    return isWeb && cfg.versionNumber; // skip the "HEAD" test deployment
  });
}

function pointDeploymentsAt_(versionNumber, note) {
  var deps = webAppDeployments_();
  if (!deps.length) throw new Error('No published web app found. Publish it once with Deploy → New deployment → Web app.');
  deps.forEach(function (d) {
    scriptApi_('/deployments/' + d.deploymentId, 'put', { deploymentConfig: {
      scriptId: ScriptApp.getScriptId(), versionNumber: versionNumber, manifestFileName: 'appsscript', description: note } });
  });
  return deps;
}

function versionOf_(source) { var m = String(source || '').match(/var APP_VERSION = '([^']+)'/); return m ? m[1] : '?'; }

function updateScriptFromGitHub() {
  var ui = SpreadsheetApp.getUi();
  try {
    var res = UrlFetchApp.fetch(GITHUB_CODE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { ui.alert('Could not download the new script from GitHub (error ' + res.getResponseCode() + '). Nothing was changed.'); return; }
    var newCode = res.getContentText();
    if (newCode.indexOf('function doPost') < 0 || newCode.indexOf('var APP_VERSION') < 0) { ui.alert('The file on GitHub does not look like the ZUSS script. Nothing was changed.'); return; }
    var current = scriptApi_('/content');
    var codeFile = (current.files || []).filter(function (f) { return f.name === 'Code'; })[0];
    var from = versionOf_(codeFile && codeFile.source), to = versionOf_(newCode);
    if (codeFile && codeFile.source === newCode) { ui.alert('Already up to date (version ' + from + ').'); return; }
    var ok = ui.alert('Update script', 'Update the ZUSS script from version ' + from + ' to ' + to + '?\n\nYou can undo this any time with ZUSS → Roll back script.', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    var files = current.files.map(function (f) {
      return { name: f.name, type: f.type, source: f.name === 'Code' ? newCode : f.source, functionSet: f.functionSet };
    });
    scriptApi_('/content', 'put', { files: files.map(function (f) { return { name: f.name, type: f.type, source: f.source }; }) });
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm');
    var v = scriptApi_('/versions', 'post', { description: 'ZUSS ' + to + ' (from GitHub, ' + stamp + ')' });
    pointDeploymentsAt_(v.versionNumber, 'ZUSS ' + to);
    ui.alert('Updated to version ' + to + ' (saved as script version ' + v.versionNumber + ').\n\nThe app uses it straight away. Reload this Sheet to refresh the ZUSS menu.\n\nIf anything goes wrong: ZUSS → Roll back script.');
  } catch (e) {
    ui.alert('Update stopped: ' + e.message + '\n\nThe app keeps running on the current version.');
  }
}

function rollbackScript() {
  var ui = SpreadsheetApp.getUi();
  try {
    var deps = webAppDeployments_();
    if (!deps.length) { ui.alert('No published web app found.'); return; }
    var currentNo = deps[0].deploymentConfig.versionNumber;
    var versions = (scriptApi_('/versions?pageSize=50').versions || []).sort(function (a, b) { return b.versionNumber - a.versionNumber; });
    var earlier = versions.filter(function (v) { return v.versionNumber < currentNo; }).slice(0, 8);
    if (!earlier.length) { ui.alert('There is no earlier version to go back to (current: ' + currentNo + ').'); return; }
    var list = earlier.map(function (v) { return v.versionNumber + ' — ' + (v.description || '(no description)') + ' — ' + String(v.createTime || '').slice(0, 10); }).join('\n');
    var r = ui.prompt('Roll back script', 'The app is on script version ' + currentNo + '.\n\nEarlier versions:\n' + list + '\n\nType the version number to go back to (or just press OK for ' + earlier[0].versionNumber + '):', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var target = Number(String(r.getResponseText()).trim() || earlier[0].versionNumber);
    if (!versions.some(function (v) { return v.versionNumber === target; })) { ui.alert('Version ' + target + ' does not exist. Nothing was changed.'); return; }
    pointDeploymentsAt_(target, 'Rolled back to version ' + target);
    // Put the editor code back too, so the Sheet menu matches what the app runs.
    var old = scriptApi_('/content?versionNumber=' + target);
    scriptApi_('/content', 'put', { files: (old.files || []).map(function (f) { return { name: f.name, type: f.type, source: f.source }; }) });
    ui.alert('Rolled back. The app now runs script version ' + target + '.\n\nReload this Sheet to refresh the ZUSS menu.');
  } catch (e) {
    ui.alert('Roll back stopped: ' + e.message);
  }
}

function scriptVersionInfo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var deps = webAppDeployments_();
    var gh = UrlFetchApp.fetch(GITHUB_CODE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    var latest = gh.getResponseCode() === 200 ? versionOf_(gh.getContentText()) : 'unknown';
    ui.alert('Script in this editor: ' + APP_VERSION + '\nApp is running script version: ' + (deps[0] ? deps[0].deploymentConfig.versionNumber + ' (' + (deps[0].deploymentConfig.description || '') + ')' : 'none') + '\nLatest on GitHub: ' + latest);
  } catch (e) {
    ui.alert('Script in this editor: ' + APP_VERSION + '\n\n(' + e.message + ')');
  }
}

function signOutAllDevices() {
  var t = table_('Sessions');
  deleteRows_(t, t.rows);
  SpreadsheetApp.getUi().alert('All devices signed out.');
}

/* ───────────────────────── Web API ───────────────────────── */

function doGet() {
  return json_({ ok: true, app: 'zuss-sales', version: APP_VERSION });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    var action = req.action;
    ensureSchema_();
    if (action === 'login') return json_(login_(req));
    var user = auth_(req.token);
    if (!user) return json_({ ok: false, error: 'AUTH', message: 'Please log in again.' });
    if (action === 'bootstrap') return json_(bootstrap_(user));
    if (action === 'sync') return json_(sync_(user, req.ops || []));
    if (action === 'resolveMap') return json_(resolveMap_(req.url));
    if (action === 'photoUpload') return json_(photoUpload_(user, req));
    if (action === 'photoGet') return json_(photoGet_(req));
    if (action === 'logout') { revokeToken_(req.token); return json_({ ok: true }); }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: 'SERVER', message: String(err && err.message || err) });
  }
}

function login_(req) {
  var name = String(req.name || '').trim();
  var pin = String(req.pin || '').trim();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + norm_(name);
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_PIN_FAILS) return { ok: false, error: 'LOCKED', message: 'Too many wrong PINs. Try again in 10 minutes.' };
  var u = table_('Users').rows.filter(function (x) { return norm_(x.name) === norm_(name) && x.active === true; })[0];
  if (!u || hash_(u.salt + pin) !== u.pin_hash) {
    cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
    return { ok: false, error: 'BADPIN', message: 'Wrong name or PIN.' };
  }
  cache.remove(failKey);
  var token = Utilities.getUuid() + Utilities.getUuid();
  appendRows_('Sessions', [{ token_hash: hash_(token), user_id: u.user_id, created_at: nowIso_(), last_seen: nowIso_() }]);
  var pu = publicUser_(u);
  return { ok: true, token: token, user: pu, data: bootstrap_(pu) };
}

function auth_(token) {
  if (!token) return null;
  var h = hash_(token);
  var s = table_('Sessions');
  var sess = s.rows.filter(function (r) { return r.token_hash === h; })[0];
  if (!sess) return null;
  var last = new Date(sess.last_seen || sess.created_at);
  if ((Date.now() - last.getTime()) > SESSION_DAYS * 864e5) return null;
  var u = table_('Users').rows.filter(function (x) { return x.user_id === sess.user_id && x.active === true; })[0];
  if (!u) return null;
  if ((Date.now() - last.getTime()) > 864e5) updateRow_(s, sess._row, { last_seen: nowIso_() });
  return publicUser_(u);
}

function revokeToken_(token) {
  var h = hash_(token);
  var s = table_('Sessions');
  deleteRows_(s, s.rows.filter(function (r) { return r.token_hash === h; }));
}

function revokeSessionsFor_(userId) {
  var s = table_('Sessions');
  deleteRows_(s, s.rows.filter(function (r) { return r.user_id === userId; }));
}

function publicUser_(u) {
  return { user_id: u.user_id, name: u.name, role: u.role, can_hq: u.can_hq === true };
}

function bootstrap_(user) {
  var strip = function (rows) { return rows.map(function (r) { var o = {}; for (var k in r) if (k !== '_row') o[k] = r[k]; return o; }); };
  var settings = {};
  table_('Settings').rows.forEach(function (r) { settings[r.key] = r.value; });
  var users = table_('Users').rows.filter(function (u) { return u.active === true; }).map(function (u) {
    return { user_id: u.user_id, name: u.name, role: u.role, can_hq: u.can_hq === true };
  });
  return {
    ok: true,
    version: APP_VERSION,
    server_time: nowIso_(),
    me: user,
    users: users,
    settings: settings,
    products: strip(table_('Products').rows).filter(function (p) { return p.active !== false; }),
    shops: strip(table_('Shops').rows),
    photos: strip(table_('Photos').rows).filter(function (p) { return p.deleted !== true; }),
    orders: strip(table_('Orders').rows),
    items: strip(table_('OrderItems').rows),
    logs: strip(table_('OrderLog').rows),
    visits: strip(table_('Visits').rows),
    favourites: table_('Favourites').rows.filter(function (f) { return f.user_id === user.user_id; }).map(function (f) { return f.shop_id; }),
    checklist: strip(table_('Checklist').rows.filter(function (c) { return c.user_id === user.user_id; }))
  };
}

/* ───────────────────────── Sync (writes) ───────────────────────── */

function sync_(user, ops) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'BUSY', message: 'Server busy, will retry.' };
  var results = [];
  try {
    ops.forEach(function (op) {
      try {
        applyOp_(user, op);
        results.push({ op_id: op.op_id, ok: true });
      } catch (err) {
        results.push({ op_id: op.op_id, ok: false, rejected: true, message: String(err && err.message || err) });
      }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, results: results };
}

function applyOp_(user, op) {
  var d = op.data || {};
  switch (op.type) {
    case 'shop.patch': return shopPatch_(user, d);
    case 'visit.add': return visitAdd_(user, d);
    case 'order.create': return orderCreate_(user, d);
    case 'order.update': return orderUpdate_(user, d);
    case 'order.event': return orderEvent_(user, d);
    case 'fav.set': return favSet_(user, d);
    case 'checklist.save': return checklistSave_(user, d);
    case 'settings.save': return settingsSave_(user, d);
    case 'pin.change': return pinChange_(user, d);
    case 'order.delete': return orderDelete_(user, d);
    case 'photo.delete': return photoDelete_(user, d);
    default: throw new Error('Unknown change type: ' + op.type);
  }
}

var SHOP_EDITABLE = ['name','contact','phone','address','area','state','stage','stockist','follow_up','potential_value','notes',
  'lat','lng','pin_accuracy_m','pinned_at','pinned_by','deleted'];

function shopPatch_(user, d) {
  if (!d.id) throw new Error('Shop id missing');
  var t = table_('Shops');
  var row = t.rows.filter(function (r) { return r.id === d.id; })[0];
  var f = d.fields || {};
  var patch = {};
  SHOP_EDITABLE.forEach(function (k) { if (f.hasOwnProperty(k)) patch[k] = f[k]; });
  if (patch.stage && STAGES.indexOf(patch.stage) < 0) throw new Error('Invalid stage');
  patch.updated_at = d.at || nowIso_();
  patch.updated_by = user.name;
  if (!row) {
    if (!patch.name) throw new Error('Shop name is required');
    patch.id = d.id;
    patch.created_at = d.at || nowIso_();
    patch.created_by = user.name;
    patch.source = patch.source || 'Added in app';
    if (!patch.stage) patch.stage = 'New';
    if (!patch.hasOwnProperty('stockist')) patch.stockist = false;
    if (!patch.hasOwnProperty('deleted')) patch.deleted = false;
    appendRows_('Shops', [patch]);
  } else {
    updateRow_(t, row._row, patch);
  }
}

function visitAdd_(user, d) {
  if (!d.id || !d.shop_id) throw new Error('Visit details missing');
  var t = table_('Visits');
  if (t.rows.some(function (r) { return r.id === d.id; })) return;
  appendRows_('Visits', [{ id: d.id, shop_id: d.shop_id, shop_name: d.shop_name || '', at: d.at || nowIso_(), by: user.name,
    note: d.note || '', lat: d.lat === undefined ? '' : d.lat, lng: d.lng === undefined ? '' : d.lng, synced_at: nowIso_() }]);
}

function cleanItems_(orderId, orderNo, items) {
  if (!items || !items.length) throw new Error('Order has no items');
  return items.map(function (it, i) {
    var qty = Math.max(0, Number(it.qty) || 0);
    var price = Number(it.unit_price) || 0;
    if (!qty) throw new Error('Item quantity must be at least 1');
    if (['carton', 'pail', 'mixed'].indexOf(it.kind) < 0) throw new Error('Invalid item type');
    return { id: it.id || (orderId + '-' + (i + 1)), order_id: orderId, order_no: orderNo, line_no: i + 1, kind: it.kind,
      product_id: it.product_id || '', description: it.description || '', size: it.size || '', qty: qty,
      bottles: Number(it.bottles) || 0, unit_price: price, line_total: round2_(qty * price), mix_detail: it.mix_detail || '' };
  });
}

function totals_(items) {
  var cartons = 0, pails = 0, total = 0;
  items.forEach(function (it) {
    if (it.kind === 'pail') pails += it.qty; else cartons += it.qty;
    total += it.line_total;
  });
  return { cartons: cartons, pails: pails, total: round2_(total) };
}

function orderCreate_(user, d) {
  var o = d.order || {};
  if (!o.id || !o.order_no || !o.shop_id) throw new Error('Order details missing');
  var t = table_('Orders');
  if (t.rows.some(function (r) { return r.id === o.id; })) return; // already saved
  var items = cleanItems_(o.id, o.order_no, d.items);
  var tot = totals_(items);
  var now = nowIso_();
  appendRows_('Orders', [{
    id: o.id, order_no: o.order_no, shop_id: o.shop_id, shop_name: o.shop_name || '', contact: o.contact || '',
    phone: o.phone || '', address: o.address || '', price_tier: o.price_tier === 'Stockist' ? 'Stockist' : 'Non-stockist',
    status: 'Confirmed', hq_status: 'Not submitted', paid: false, commission_eligible: o.commission_eligible !== false,
    cartons: tot.cartons, pails: tot.pails, total: tot.total, notes: o.notes || '',
    created_at: o.created_at || now, created_by: user.name, updated_at: o.created_at || now, updated_by: user.name, synced_at: now
  }]);
  appendRows_('OrderItems', items);
  if (d.log) addLog_(user, o.id, o.order_no, d.log);
}

function orderUpdate_(user, d) {
  var t = table_('Orders');
  var row = t.rows.filter(function (r) { return r.id === d.order_id; })[0];
  if (!row) throw new Error('Order not found');
  if (d.log && logExists_(d.log.id)) return; // already applied
  if (row.status === 'Cancelled') throw new Error('Order is cancelled and cannot be edited');
  if (row.hq_status !== 'Not submitted') throw new Error('Order already submitted to HQ (' + row.hq_status + '); it can no longer be edited');
  var items = cleanItems_(row.id, row.order_no, d.items);
  var tot = totals_(items);
  var it = table_('OrderItems');
  deleteRows_(it, it.rows.filter(function (r) { return r.order_id === row.id; }));
  appendRows_('OrderItems', items);
  var patch = { cartons: tot.cartons, pails: tot.pails, total: tot.total, updated_at: (d.log && d.log.at) || nowIso_(), updated_by: user.name };
  if (d.hasOwnProperty('notes')) patch.notes = d.notes;
  if (d.hasOwnProperty('commission_eligible')) patch.commission_eligible = d.commission_eligible !== false;
  updateRow_(t, row._row, patch);
  if (d.log) addLog_(user, row.id, row.order_no, d.log);
}

function orderEvent_(user, d) {
  var t = table_('Orders');
  var row = t.rows.filter(function (r) { return r.id === d.order_id; })[0];
  if (!row) throw new Error('Order not found');
  if (!d.log || !d.log.id) throw new Error('Event details missing');
  if (logExists_(d.log.id)) return;
  var set = d.set || {};
  var patch = {};
  if (set.hasOwnProperty('hq_status')) {
    if (!user.can_hq) throw new Error('Only the salesman handling HQ can change HQ status');
    if (HQ_STATUSES.indexOf(set.hq_status) < 0) throw new Error('Invalid HQ status');
    if (row.status === 'Cancelled') throw new Error('Order is cancelled');
    patch.hq_status = set.hq_status;
  }
  if (set.hasOwnProperty('paid')) patch.paid = set.paid === true;
  if (set.hasOwnProperty('status')) {
    if (set.status !== 'Cancelled' && set.status !== 'Confirmed') throw new Error('Invalid order status');
    patch.status = set.status;
  }
  if (Object.keys(patch).length) {
    patch.updated_at = d.log.at || nowIso_();
    patch.updated_by = user.name;
    updateRow_(t, row._row, patch);
  }
  addLog_(user, row.id, row.order_no, d.log);
}

// Permanently remove a cancelled order with its items and log (for test/mistake orders). Admin only.
function orderDelete_(user, d) {
  if (user.role !== 'admin') throw new Error('Only the admin can delete orders');
  var t = table_('Orders');
  var row = t.rows.filter(function (r) { return r.id === d.order_id; })[0];
  if (!row) return; // already deleted
  if (row.status !== 'Cancelled') throw new Error('Cancel the order first, then delete it');
  var it = table_('OrderItems');
  deleteRows_(it, it.rows.filter(function (r) { return r.order_id === row.id; }));
  var lg = table_('OrderLog');
  deleteRows_(lg, lg.rows.filter(function (r) { return r.order_id === row.id; }));
  deleteRows_(table_('Orders'), [row]);
}

/* ───────────────────────── Photos (name card, SSM) ─────────────────────────
 * Files are saved in your Google Drive: "ZUSS Sales — Photos / <shop name>".
 * The Photos tab lists them (click the url column to open one). Files are private to your Drive;
 * the app fetches them through this script after PIN login. */

function photoFolder_(shopId, shopName) {
  var props = PropertiesService.getScriptProperties();
  var openFolder = function (key) {
    var id = props.getProperty(key);
    if (!id) return null;
    try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; }
  };
  var root = openFolder('photo_root');
  if (!root) { root = DriveApp.createFolder('ZUSS Sales — Photos'); props.setProperty('photo_root', root.getId()); }
  var key = 'photo_f_' + shopId;
  var folder = openFolder(key);
  if (!folder) { folder = root.createFolder(String(shopName || shopId).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80)); props.setProperty(key, folder.getId()); }
  return folder;
}

function resetPhotoFolders_() {
  var props = PropertiesService.getScriptProperties();
  var root = props.getProperty('photo_root');
  if (root) { try { DriveApp.getFolderById(root).setTrashed(true); } catch (e) { /* already gone */ } }
  Object.keys(props.getProperties()).forEach(function (k) { if (k === 'photo_root' || k.indexOf('photo_f_') === 0) props.deleteProperty(k); });
}

function photoUpload_(user, req) {
  var m = req.meta || {};
  if (!m.id || !m.shop_id || !PHOTO_KINDS[m.kind]) return { ok: false, message: 'Photo details missing' };
  var data = String(req.data || '');
  if (!data) return { ok: false, message: 'Photo is empty' };
  if (data.length > 12000000) return { ok: false, rejected: true, message: 'Photo is too large' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'BUSY', message: 'Server busy, will retry.' };
  try {
    var t = table_('Photos');
    var existing = t.rows.filter(function (r) { return r.id === m.id; })[0];
    var strip = function (r) { var o = {}; for (var k in r) if (k !== '_row') o[k] = r[k]; return o; };
    if (existing) return { ok: true, photo: strip(existing) }; // retry of an upload that already landed
    var shop = table_('Shops').rows.filter(function (r) { return r.id === m.shop_id; })[0];
    var shopName = (shop && shop.name) || m.shop_name || m.shop_id;
    var takenAt = m.taken_at || nowIso_();
    var count = t.rows.filter(function (r) { return r.shop_id === m.shop_id && r.kind === m.kind; }).length + 1;
    var fileName = shopName + ' - ' + PHOTO_KINDS[m.kind] + ' ' + count + ' - ' + takenAt.slice(0, 10) + '.jpg';
    var mime = /^image\/(jpeg|png|webp)$/.test(req.mime) ? req.mime : 'image/jpeg';
    var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, fileName);
    var file = photoFolder_(m.shop_id, shopName).createFile(blob);
    var rec = { id: m.id, shop_id: m.shop_id, shop_name: shopName, kind: m.kind, file_id: file.getId(), file_name: fileName,
      url: 'https://drive.google.com/file/d/' + file.getId() + '/view', mime: mime, taken_at: takenAt, by: user.name, deleted: false, synced_at: nowIso_() };
    appendRows_('Photos', [rec]);
    SpreadsheetApp.flush();
    return { ok: true, photo: rec };
  } finally {
    lock.releaseLock();
  }
}

function photoGet_(req) {
  var row = table_('Photos').rows.filter(function (r) { return r.id === req.id; })[0];
  if (!row || row.deleted === true) return { ok: false, message: 'Photo not found' };
  var blob = DriveApp.getFileById(row.file_id).getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function photoDelete_(user, d) {
  var t = table_('Photos');
  var row = t.rows.filter(function (r) { return r.id === d.id; })[0];
  if (!row || row.deleted === true) return;
  updateRow_(t, row._row, { deleted: true });
  try { DriveApp.getFileById(row.file_id).setTrashed(true); } catch (e) { /* file already gone */ }
}

/* Adds tabs/columns introduced by app updates (never removes or reorders data). Runs once per SCHEMA_VERSION. */
function ensureSchema_(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('schema_v') === String(SCHEMA_VERSION)) return;
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); delete TABLE_CACHE_[name]; });
    hideSensitiveTabs_(ss);
    props.setProperty('schema_v', String(SCHEMA_VERSION));
  } finally {
    if (locked) lock.releaseLock();
  }
}

function logExists_(id) {
  return table_('OrderLog').rows.some(function (r) { return r.id === id; });
}

function addLog_(user, orderId, orderNo, log) {
  if (logExists_(log.id)) return;
  appendRows_('OrderLog', [{ id: log.id, order_id: orderId, order_no: orderNo, at: log.at || nowIso_(), by: user.name,
    event: log.event || '', detail: log.detail || '', synced_at: nowIso_() }]);
}

function favSet_(user, d) {
  var t = table_('Favourites');
  var rows = t.rows.filter(function (r) { return r.user_id === user.user_id && r.shop_id === d.shop_id; });
  if (d.on && !rows.length) appendRows_('Favourites', [{ user_id: user.user_id, shop_id: d.shop_id }]);
  if (!d.on) deleteRows_(t, rows);
}

function checklistSave_(user, d) {
  if (!d.date) throw new Error('Date missing');
  var id = d.date + '|' + user.user_id;
  var t = table_('Checklist');
  var row = t.rows.filter(function (r) { return r.id === id; })[0];
  var rec = { id: id, date: d.date, user_id: user.user_id, done: JSON.stringify(d.done || []),
    decision_makers: Number(d.decision_makers) || 0, notes: d.notes || '', updated_at: d.at || nowIso_() };
  if (row) updateRow_(t, row._row, rec); else appendRows_('Checklist', [rec]);
}

function settingsSave_(user, d) {
  if (user.role !== 'admin') throw new Error('Only the admin can change settings');
  var allowed = DEFAULT_SETTINGS.map(function (r) { return r[0]; });
  var t = table_('Settings');
  Object.keys(d.values || {}).forEach(function (k) {
    if (allowed.indexOf(k) < 0) return;
    var row = t.rows.filter(function (r) { return r.key === k; })[0];
    if (row) updateRow_(t, row._row, { value: String(d.values[k]) });
    else appendRows_('Settings', [{ key: k, value: String(d.values[k]), note: '' }]);
  });
}

function pinChange_(user, d) {
  var t = table_('Users');
  var u = t.rows.filter(function (r) { return r.user_id === user.user_id; })[0];
  if (!u) throw new Error('User not found');
  if (hash_(u.salt + String(d.old_pin || '')) !== u.pin_hash) throw new Error('Current PIN is wrong');
  if (!/^\d{4,8}$/.test(String(d.new_pin || ''))) throw new Error('New PIN must be 4–8 digits');
  var salt = Utilities.getUuid();
  updateRow_(t, u._row, { pin_hash: hash_(salt + String(d.new_pin)), salt: salt });
}

/* Turn a Google Maps link (including maps.app.goo.gl short links shared from phones) into lat/lng.
 * 1) Follow redirects (HTTP, meta-refresh and script redirects) and read coordinates from each address.
 * 2) Read coordinates from the final page.
 * 3) If Google only gives the place name/address, look it up with Google's geocoder (approximate).
 * On failure, returns a short trail of what was seen so it can be diagnosed. */
function resolveMap_(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'That is not a link. Copy the link from Google Maps → Share → Copy link.' };
  var FAIL = 'Could not read a location from that link. Easiest fix: at the shop, tap "Pin this location". Or in Google Maps, long-press the shop, copy the numbers shown (e.g. 6.12345, 102.23456) and paste those.';
  var trail = [];
  var placeText = '';
  try {
    for (var hop = 0; hop < 10; hop++) {
      trail.push('URL ' + url.slice(0, 300));
      var ll = parseLatLng_(url);
      if (ll && inServiceArea_(ll)) return { ok: true, lat: ll[0], lng: ll[1] };
      if (ll) trail.push('ignored ' + ll.join(',') + ' (outside Malaysia — Google default map, not the shop)');
      placeText = placeTextFrom_(url) || placeText;
      var cont = url.match(/[?&]continue=([^&]+)/);
      if (cont) { url = safeDecode_(cont[1]); continue; }
      if (!/goo\.gl|maps\.app|g\.co|google\./i.test(url)) break;
      var res = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true,
        headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } });
      var h = res.getHeaders() || {};
      var loc = h['Location'] || h['location'];
      var code = res.getResponseCode ? res.getResponseCode() : '';
      if (loc) { trail.push(code + ' → redirect'); url = absoluteUrl_(url, loc); continue; }
      var body = String(res.getContentText() || '').slice(0, 800000);
      trail.push(code + ' page ' + body.length + ' chars: ' + body.replace(/\s+/g, ' ').slice(0, 160));
      ll = parseLatLng_(body, true);
      if (ll && inServiceArea_(ll)) return { ok: true, lat: ll[0], lng: ll[1] };
      if (ll) trail.push('ignored ' + ll.join(',') + ' from page (outside Malaysia)');
      var next = nextUrlFromPage_(body);
      if (next && next !== url) { url = absoluteUrl_(url, next); continue; }
      placeText = placeTextFrom_(body, true) || placeText;
      break;
    }
    if (placeText) {
      var g = geocode_(placeText);
      trail.push('geocode "' + placeText.slice(0, 120) + '" → ' + (g ? g.join(',') : 'none'));
      if (g && inServiceArea_(g)) return { ok: true, lat: g[0], lng: g[1], approx: true, place: placeText };
    }
  } catch (err) {
    trail.push('error ' + String(err && err.message || err));
  }
  return { ok: false, message: FAIL, trail: trail.join('\n').slice(0, 2500) };
}

// Redirect hidden inside an HTML page (meta refresh, script, canonical/og:url).
function nextUrlFromPage_(body) {
  var b = safeDecode_(body);
  var pats = [/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i, /location\.(?:replace|href)\s*\(?\s*=?\s*["']([^"']+)["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i, /property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]+property=["']og:url["']/i, /href=["'](https?:\/\/(?:www\.)?google\.[^"']*\/maps[^"']+)["']/i];
  for (var i = 0; i < pats.length; i++) {
    var m = b.match(pats[i]);
    if (m && (/google|goo\.gl/i.test(m[1]) || m[1].charAt(0) === '/')) return m[1];
  }
  return '';
}

// Place name / address carried in a Maps link (q=..., /maps/place/NAME) or page title.
function placeTextFrom_(s, isPage) {
  s = safeDecode_(s);
  var m = s.match(/[?&](?:q|query|daddr|destination)=([^&#]+)/) || s.match(/\/maps\/place\/([^\/?#@]+)/) ||
    (isPage ? (s.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || s.match(/<title>([^<]+)<\/title>/i)) : null);
  if (!m) return '';
  var t = m[1].replace(/\+/g, ' ').replace(/\s*[·|-]\s*Google Maps\s*$/i, '').trim();
  if (!t || /^-?\d+\.\d+\s*,/.test(t) || /^google maps$/i.test(t)) return '';
  return t;
}

// Shops are all in Malaysia. Google's servers are in the US, and when Google doesn't recognise a
// link it returns its default map (centre of the USA, 37.0625,-95.677068). Anything outside
// Malaysia is therefore never the shop and is rejected.
var SERVICE_AREA = { latMin: 0.8, latMax: 7.5, lngMin: 99.5, lngMax: 119.5 };
function inServiceArea_(ll) {
  var a = SERVICE_AREA;
  return ll && ll[0] >= a.latMin && ll[0] <= a.latMax && ll[1] >= a.lngMin && ll[1] <= a.lngMax;
}

function geocode_(text) {
  try {
    var b = SERVICE_AREA;
    var r = Maps.newGeocoder().setRegion('my').setBounds(b.latMin, b.lngMin, b.latMax, b.lngMax).geocode(text);
    if (r && r.status === 'OK' && r.results && r.results.length) {
      var l = r.results[0].geometry.location;
      if (okLatLng_(l.lat, l.lng)) return [Number(l.lat.toFixed(6)), Number(l.lng.toFixed(6))];
    }
  } catch (e) { /* geocoder unavailable */ }
  return null;
}

function absoluteUrl_(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var m = base.match(/^(https?:\/\/[^\/]+)/i);
  return (m ? m[1] : '') + (loc.charAt(0) === '/' ? '' : '/') + loc;
}

// decodeURIComponent throws "URI malformed" on stray % signs; decode piece by piece instead.
function safeDecode_(s) {
  s = String(s || '');
  for (var i = 0; i < 2; i++) {
    try { s = decodeURIComponent(s); }
    catch (e) { s = s.replace(/%[0-9a-f]{2}/gi, function (x) { try { return decodeURIComponent(x); } catch (e2) { return x; } }); }
  }
  return s.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\u003d/g, '=');
}

function okLatLng_(lat, lng) {
  return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

// Most precise patterns first. isPage = text of a Google Maps web page rather than a link.
function parseLatLng_(s, isPage) {
  s = safeDecode_(s);
  var pats = [
    [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, false],                                   // exact place pin
    [/[?&](?:center|markers)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/, false],           // static map preview of the place
    [/@(-?\d+\.\d+),(-?\d+\.\d+)/, false],                                        // map view at the place
    [/[?&](?:q|query|ll|destination|daddr|sll)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/, false],
    [/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)\s*$/, false]                  // plain "lat, lng"
  ];
  if (isPage) pats.push([/APP_INITIALIZATION_STATE=\[\[\[-?[\d.]+,(-?\d+\.\d+),(-?\d+\.\d+)\]/, true]); // [zoom, lng, lat]
  for (var i = 0; i < pats.length; i++) {
    var m = s.match(pats[i][0]);
    if (m) {
      var a = Number(m[1]), b = Number(m[2]);
      var lat = pats[i][1] ? b : a, lng = pats[i][1] ? a : b;
      if (okLatLng_(lat, lng)) return [lat, lng];
    }
  }
  return null;
}

/* ───────────────────────── Sheet helpers ───────────────────────── */

var TABLE_CACHE_ = {};

function ensureSheet_(ss, name) {
  var cols = SCHEMA[name];
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  var lastCol = sh.getLastColumn();
  var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  // Add any missing columns at the end (never reorders or deletes existing data).
  cols.forEach(function (c) {
    if (have.indexOf(c[0]) < 0) { have.push(c[0]); sh.getRange(1, have.length).setValue(c[0]); }
  });
  var maxRows = Math.max(sh.getMaxRows(), 2);
  have.forEach(function (h, i) {
    var def = cols.filter(function (c) { return c[0] === h; })[0];
    if (def && def[1] === 's') sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat('@');
  });
  sh.getRange(1, 1, 1, have.length).setFontWeight('bold').setBackground('#17324d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return created;
}

function hideSensitiveTabs_(ss) {
  ['Users', 'Sessions'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh) { sh.hideSheet(); try { sh.protect().setWarningOnly(true).setDescription('Managed by the ZUSS app — use the ZUSS menu instead of editing.'); } catch (e) {} }
  });
}

function table_(name) {
  if (TABLE_CACHE_[name]) return TABLE_CACHE_[name];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing. Run ZUSS → Set up sheet.');
  // One read per tab (much faster than several small reads).
  var all = sh.getDataRange().getValues();
  var headers = all.length ? all[0].map(String) : [];
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  var values = all.slice(1);
  var types = {};
  (SCHEMA[name] || []).forEach(function (c) { types[c[0]] = c[1]; });
  var rows = [];
  values.forEach(function (v, i) {
    if (v.every(function (x) { return x === '' || x === null; })) return;
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = fromCell_(v[j], types[h]); });
    rows.push(o);
  });
  var t = { name: name, sheet: sh, headers: headers, rows: rows, types: types };
  TABLE_CACHE_[name] = t;
  return t;
}

function fromCell_(v, type) {
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (type === 'n') return v === '' || v === null ? '' : Number(v);
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Kuala_Lumpur', "yyyy-MM-dd'T'HH:mm:ss'+08:00'");
  return v === null ? '' : String(v);
}

function toCell_(v, type) {
  if (v === undefined || v === null) return '';
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (type === 'n') return v === '' ? '' : (isFinite(Number(v)) ? Number(v) : '');
  return String(v);
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var t = table_(name);
  var data = objs.map(function (o) { return t.headers.map(function (h) { return toCell_(o[h], t.types[h]); }); });
  var start = t.sheet.getLastRow() + 1;
  var needed = start + data.length - 1 - t.sheet.getMaxRows();
  if (needed > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), needed + 200);
  t.headers.forEach(function (h, j) {
    if (t.types[h] === 's') t.sheet.getRange(start, j + 1, data.length, 1).setNumberFormat('@');
  });
  t.sheet.getRange(start, 1, data.length, t.headers.length).setValues(data);
  delete TABLE_CACHE_[name];
}

function deleteRows_(t, rows) {
  rows.slice().sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { t.sheet.deleteRow(r._row); });
  delete TABLE_CACHE_[t.name];
}

function updateRow_(t, rowNum, patch) {
  var range = t.sheet.getRange(rowNum, 1, 1, t.headers.length);
  var cur = range.getValues()[0];
  t.headers.forEach(function (h, j) { if (patch.hasOwnProperty(h)) cur[j] = toCell_(patch[h], t.types[h]); });
  range.setValues([cur]);
  delete TABLE_CACHE_[t.name];
}

function countRows_(name) { return table_(name).rows.length; }

function seedProducts_() { appendRows_('Products', SEED_PRODUCTS); }

function seedShops_() {
  var now = nowIso_();
  appendRows_('Shops', SEED_SHOPS.map(function (s) {
    return { id: s.id, name: s.name, contact: '', phone: s.phone, address: s.address, area: s.area, state: s.state,
      stage: 'New', stockist: false, follow_up: '', potential_value: '', notes: s.notes, lat: '', lng: '', pin_accuracy_m: '',
      pinned_at: '', pinned_by: '', source: s.source, created_at: now, created_by: 'Survey', updated_at: now, updated_by: 'Survey', deleted: false };
  }));
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function norm_(s) { return String(s || '').trim().toLowerCase(); }
function round2_(n) { return Math.round(Number(n) * 100) / 100; }
function nowIso_() { return Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', "yyyy-MM-dd'T'HH:mm:ss'+08:00'"); }
