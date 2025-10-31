import assert from 'assert';
import { isBusinessHoursPR, detectIntent, detectLang } from '../lib/helpers.js';

function run() {
  console.log('Running quick tests...');

  // isBusinessHoursPR: test a Monday 13:00 PR (UTC-4 => 17:00 UTC)
  const mondayPR = new Date(Date.UTC(2025, 9, 20, 17, 0, 0)); // 2025-10-20 17:00 UTC == 13:00 PR
  assert.strictEqual(isBusinessHoursPR(mondayPR), true, 'Expected business hours on Monday 13:00 PR');

  // detectIntent
  assert.strictEqual(detectIntent('Tengo una fuga de agua en la cocina'), 'EMERGENCIA');
  assert.strictEqual(detectIntent('Quiero agendar una cita'), 'AGENDAR');
  assert.strictEqual(detectIntent('Necesito una cotizacion'), 'COTIZACION');
  assert.strictEqual(detectIntent('No se que hacer'), 'OTRO');

  // detectLang
  assert.strictEqual(detectLang('I need to schedule an appointment'), 'EN');
  assert.strictEqual(detectLang('Necesito una cita'), 'ES');

  console.log('All tests passed ✅');
}

run();
