import { spawnSync } from 'child_process';
import path from 'path';

describe('scripts/send-test-wa.js (script)', () => {
  test('prints dry-run result when TWILIO not configured', () => {
    const script = path.resolve(process.cwd(), 'scripts', 'send-test-wa.js');
    const cp = spawnSync('node', [script, 'whatsapp:+15555550123'], {
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 5000
    });

    // script prints a warning about missing TWILIO_WHATSAPP_NUMBER and dry-run metadata
    expect(cp.stdout).toBeDefined();
    const out = String(cp.stdout) + String(cp.stderr);
    expect(out).toMatch(/Twilio live-sends disabled|dry-run/i);
  });
});
