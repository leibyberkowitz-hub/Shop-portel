// Standalone server for local development or self-hosting (not used on Vercel).
require('./src/env');
const app = require('./src/app');
const { twilioConfigured } = require('./src/sms');
const { authEnabled } = require('./src/auth');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Fish shop manager running at http://localhost:${PORT}`);
  console.log(
    twilioConfigured()
      ? 'SMS: Twilio configured — texts will really be sent.'
      : 'SMS: simulation mode (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to send real texts).'
  );
  if (!authEnabled()) {
    console.log('Auth: DISABLED — set STAFF_PASSWORD to require a login.');
  }
});
