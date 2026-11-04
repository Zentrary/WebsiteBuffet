const { renderSocketClient } = require('../services/realtimeClientSource');

module.exports = function socketClient(_req, res) {
  const body = renderSocketClient({
    supabaseUrl: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  });
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  return res.status(200).send(body);
};
