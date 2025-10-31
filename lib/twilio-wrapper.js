import twilio from 'twilio';

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  ENABLE_TWILIO = 'false'
} = process.env;

// Normalize the enable flag to a boolean (allow 'true'/'1' case-insensitive)
const enableTwilio = String(ENABLE_TWILIO).toLowerCase() === 'true' || String(ENABLE_TWILIO) === '1';

let client = null;
// Only initialize the real Twilio client when both credentials are present and
// the explicit ENABLE_TWILIO flag is enabled. This prevents accidental live
// sends in development or CI when credentials are present but live sends are
// not intended.
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && enableTwilio) {
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Send a message via Twilio (or perform a dry-run when Twilio is disabled).
 *
 * Params should include the Twilio-required fields such as `from`, `to` and
 * either `body` or `mediaUrl` depending on the use case.
 *
 * Returns the Twilio response object when live. For dry-runs returns an object
 * with a synthetic `sid` and a `dryRun` flag.
 */
export async function createMessage(params = {}) {
  // Basic validation to provide clearer errors than the Twilio SDK when inputs
  // are missing (the SDK errors can be less explicit in some environments).
  const { from, to, body, mediaUrl, mediaUrls } = params;
  const hasContent = Boolean(body) || Boolean(mediaUrl) || (Array.isArray(mediaUrls) && mediaUrls.length > 0);

  if (!from || !to || !hasContent) {
    const missing = [];
    if (!from) missing.push('from');
    if (!to) missing.push('to');
    if (!hasContent) missing.push('body|mediaUrl|mediaUrls');
    const err = new Error('Missing required params: ' + missing.join(', '));
    err.code = 'MISSING_PARAMS';
    throw err;
  }

  // If client not configured for live sends, return a dry-run response for safety.
  if (!client) {
    const dry = {
      sid: 'dry-run-' + Date.now(),
      dryRun: true,
      params: { from, to, body, mediaUrl, mediaUrls },
      metadata: {
        enableTwilio: enableTwilio,
        hasCreds: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
      }
    };
    console.warn('Twilio live-sends disabled — performing dry-run for createMessage', dry.metadata);
    return dry;
  }

  // Delegate to Twilio SDK in live mode and surface errors to the caller.
  try {
    return await client.messages.create(params);
  } catch (err) {
    // Re-throw with minimal additional context so callers can handle it.
    err.twilio = true;
    throw err;
  }
}

export default { createMessage };
