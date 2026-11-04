const { AsyncLocalStorage } = require('async_hooks');

const TOPIC = 'buffet-live';
const storage = new AsyncLocalStorage();

function getStore() {
  return storage.getStore() || null;
}

function pushEvent(event, rooms, data) {
  const store = getStore();
  if (!store || !event) return;
  store.pending.push({
    event: String(event),
    rooms: Array.isArray(rooms) ? rooms.filter(Boolean).map(String) : [],
    data,
  });
}

function createChain(rooms) {
  return {
    to(room) {
      return createChain(rooms.concat(String(room || '')));
    },
    in(room) {
      return this.to(room);
    },
    emit(event, data) {
      pushEvent(event, rooms, data);
      return this;
    },
  };
}

function createServerlessIo() {
  return {
    to(room) {
      return createChain([String(room || '')]);
    },
    in(room) {
      return createChain([String(room || '')]);
    },
    emit(event, data) {
      pushEvent(event, [], data);
      return this;
    },
    on() {
      return this;
    },
    use() {
      return this;
    },
    engine: { clientsCount: 0 },
  };
}

function runWithRealtime(fn) {
  return storage.run({ pending: [] }, fn);
}

function pendingSnapshot() {
  const store = getStore();
  if (!store) return [];
  return store.pending.map((item) => ({
    event: item.event,
    rooms: item.rooms.slice(),
  }));
}

function serializePayload(data) {
  if (data === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error) {
    return { note: 'unserializable', message: error.message };
  }
}

async function postBroadcast(messages) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!base || !key || messages.length === 0) {
    return { sent: 0, skipped: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('Supabase Realtime broadcast failed:', response.status, text.slice(0, 300));
      return { sent: 0, status: response.status };
    }
    return { sent: messages.length };
  } catch (error) {
    console.error('Supabase Realtime broadcast error:', error.message);
    return { sent: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function flushRealtime() {
  const store = getStore();
  if (!store || store.pending.length === 0) return { sent: 0 };
  const batch = store.pending.splice(0, store.pending.length);
  const messages = [];
  for (const item of batch) {
    if (!item.event) continue;
    messages.push({
      topic: TOPIC,
      event: item.event,
      private: false,
      payload: {
        rooms: item.rooms,
        data: serializePayload(item.data),
      },
    });
  }
  if (messages.length === 0) return { sent: 0 };
  const chunks = [];
  for (let index = 0; index < messages.length; index += 20) {
    chunks.push(messages.slice(index, index + 20));
  }
  let sent = 0;
  for (const chunk of chunks) {
    const result = await postBroadcast(chunk);
    sent += result.sent || 0;
  }
  return { sent };
}

function bindResponseFlush(res) {
  if (!res || res.__realtimeFlushBound || typeof res.end !== 'function') return;
  res.__realtimeFlushBound = true;
  const originalEnd = res.end;
  let settled = false;
  res.end = function patchedEnd(...args) {
    if (settled) return this;
    settled = true;
    const self = this;
    Promise.resolve()
      .then(() => flushRealtime())
      .catch((error) => {
        console.error('Realtime flush failed:', error.message);
      })
      .then(() => {
        try {
          originalEnd.apply(self, args);
        } catch (error) {
          console.error('Response end after realtime flush failed:', error.message);
        }
      });
    return self;
  };
}

module.exports = {
  TOPIC,
  createServerlessIo,
  runWithRealtime,
  flushRealtime,
  bindResponseFlush,
  pendingSnapshot,
};
