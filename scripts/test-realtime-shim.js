const assert = require('assert');
const {
  createServerlessIo,
  runWithRealtime,
  pendingSnapshot,
} = require('../services/realtimeBroadcast');
const { renderSocketClient } = require('../services/realtimeClientSource');

async function main() {
  await runWithRealtime(async () => {
    const io = createServerlessIo();
    io.to('admin').to('waiter').emit('checkout_requested', { sessionId: 'abc' });
    io.to('kitchen').emit('new_order', { id: 1 });
    io.emit('table_board_updated');
    const pending = pendingSnapshot();
    assert.strictEqual(pending.length, 3);
    assert.deepStrictEqual(pending[0], {
      event: 'checkout_requested',
      rooms: ['admin', 'waiter'],
    });
    assert.deepStrictEqual(pending[1], { event: 'new_order', rooms: ['kitchen'] });
    assert.deepStrictEqual(pending[2], { event: 'table_board_updated', rooms: [] });
  });

  const source = renderSocketClient({
    supabaseUrl: 'https://example.supabase.co',
    anonKey: 'anon-key',
  });
  assert.ok(source.includes('https://example.supabase.co'));
  assert.ok(source.includes('anon-key'));
  assert.ok(source.includes('function io('));
  assert.ok(source.includes('realtime:buffet-live') || source.includes("'realtime:' + TOPIC"));
  assert.ok(!source.includes('__CONFIG_JSON__'));
  new Function(source);
  console.log('realtime shim ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
