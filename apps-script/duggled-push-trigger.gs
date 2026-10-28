/**
 * Duggled Ops — automatic Google Sheets → Vercel Push checks.
 * Paste into a NEW .gs file in the Apps Script project associated with
 * the Duggled prospecting spreadsheet. Do not change doGet / doPost.
 *
 * Before first run: Project Settings > Script properties
 *  DUGGLED_OPS_CRON_SECRET = same value as Vercel's CRON_SECRET.
 *  DUGGLED_OPS_VERCEL_BYPASS = Vercel Deployment Protection automation bypass token.
 *
 * Run duggledOpsInstallPushTrigger() once and grant permissions.
 */
function duggledOpsPushTick() {
  var secret = PropertiesService.getScriptProperties().getProperty('DUGGLED_OPS_CRON_SECRET');
  if (!secret) throw new Error('Missing Script property: DUGGLED_OPS_CRON_SECRET');
  var bypass = PropertiesService.getScriptProperties().getProperty('DUGGLED_OPS_VERCEL_BYPASS');
  if (!bypass) throw new Error('Falta DUGGLED_OPS_VERCEL_BYPASS en Propiedades de secuencia de comandos: Vercel Authentication bloquea /api/cron.');
  var response = UrlFetchApp.fetch('https://duggled-ops.vercel.app/api/cron', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secret, 'x-vercel-protection-bypass': bypass },
    followRedirects: true,
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  var headers = response.getAllHeaders();
  var contentType = String(headers['Content-Type'] || headers['content-type'] || '');
  if (code !== 200) {
    throw new Error('Duggled Ops HTTP ' + code + ' (' + contentType + '): ' + body.slice(0,250));
  }
  var result;
  try { result = JSON.parse(body); }
  catch (err) { throw new Error('Respuesta JSON inválida: ' + body.slice(0,300)); }
  console.log('Duggled Ops Push: ' + JSON.stringify(result));
  return result;
}
function duggledOpsInstallPushTrigger() {
  var name = 'duggledOpsPushTick';
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === name;
  }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(name).timeBased().everyMinutes(1).create();
  // First run builds a baseline. Existing prospect rows won't generate false positives.
  return duggledOpsPushTick();
}
function duggledOpsRemovePushTrigger() {
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'duggledOpsPushTick';
  }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
}
