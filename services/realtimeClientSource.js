const CLIENT_SOURCE = `(function (root) {
  var cfg = __CONFIG_JSON__;
  var TOPIC = 'buffet-live';

  function createSocket() {
    var handlers = {};
    var rooms = {};
    var connected = false;
    var refCounter = 0;
    var joinRef = null;
    var ws = null;
    var heartbeat = null;
    var closedByUser = false;
    var reconnectAttempt = 0;
    var everConnected = false;
    var reconnectTimer = null;

    function nextRef() {
      refCounter += 1;
      return String(refCounter);
    }

    function fire(event, arg) {
      var list = handlers[event] || [];
      list.slice().forEach(function (callback) {
        try {
          callback(arg);
        } catch (error) {
          console.error('Realtime listener failed:', error);
        }
      });
    }

    var socket = {
      connected: false,
      on: function (event, callback) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(callback);
        return socket;
      },
      off: function (event, callback) {
        if (!handlers[event]) return socket;
        handlers[event] = callback
          ? handlers[event].filter(function (item) {
              return item !== callback;
            })
          : [];
        return socket;
      },
      emit: function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        if (event === 'joinRoom') {
          var requested =
            typeof args[0] === 'string' ? args[0] : args[0] && args[0].room;
          if (requested) rooms[requested] = true;
          if (ack) ack({ success: true, room: requested || '' });
          return socket;
        }
        if (event === 'joinSession') {
          var sessionId = String(args[0] || '');
          if (sessionId) rooms['customer_' + sessionId] = true;
          if (ack) ack({ success: true, room: sessionId ? 'customer_' + sessionId : '' });
          return socket;
        }
        if (event === 'joinQueue') {
          var request = args[0] || {};
          var queueId = typeof request === 'string' ? request : request.queueId;
          if (queueId) rooms['queue_' + queueId] = true;
          if (ack) ack({ success: true, room: queueId ? 'queue_' + queueId : '' });
          return socket;
        }
        if (event === 'checkout_requested') {
          var payload = args[0] || {};
          var checkoutSessionId = payload.sessionId;
          if (!checkoutSessionId) {
            if (ack) ack({ success: false, message: 'รูปแบบ Session ID ไม่ถูกต้อง' });
            return socket;
          }
          fetch('/api/session/' + encodeURIComponent(checkoutSessionId) + '/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
            .then(function (response) {
              return response.json().then(function (body) {
                return { ok: response.ok, body: body };
              });
            })
            .then(function (result) {
              if (!ack) return;
              ack(
                result.ok && result.body && result.body.success !== false
                  ? { success: true, message: result.body.message || '' }
                  : {
                      success: false,
                      message: (result.body && result.body.message) || 'ไม่สามารถส่งคำขอได้',
                    }
              );
            })
            .catch(function () {
              if (ack) ack({ success: false, message: 'ไม่สามารถส่งคำขอได้' });
            });
          return socket;
        }
        return socket;
      },
      disconnect: function () {
        closedByUser = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        cleanup();
        setConnected(false);
        return socket;
      },
    };

    function setConnected(value) {
      var wasConnected = connected;
      connected = Boolean(value);
      socket.connected = connected;
      if (connected && !wasConnected) {
        fire('connect');
        if (everConnected) fire('reconnect');
        everConnected = true;
      } else if (!connected && wasConnected) {
        fire('disconnect');
      }
    }

    function send(topic, event, payload, refId) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          topic: topic,
          event: event,
          payload: payload || {},
          ref: refId,
          join_ref: joinRef,
        })
      );
    }

    function cleanup() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch (error) {}
        ws = null;
      }
    }

    function scheduleReconnect() {
      if (closedByUser) return;
      reconnectAttempt += 1;
      var delay = Math.min(15000, 400 * Math.pow(2, Math.min(reconnectAttempt, 5)));
      reconnectTimer = setTimeout(connect, delay);
    }

    function handleFrame(frame) {
      if (!frame || typeof frame !== 'object') return;
      if (frame.event === 'phx_reply' && String(frame.ref) === String(joinRef)) {
        var status = frame.payload && frame.payload.status;
        if (status === 'ok') {
          reconnectAttempt = 0;
          setConnected(true);
        } else {
          fire('connect_error', new Error('Realtime join failed'));
          try {
            if (ws) ws.close();
          } catch (error) {}
        }
        return;
      }
      if (frame.event !== 'broadcast') return;
      var inner = frame.payload || {};
      var eventName = inner.event;
      if (!eventName || eventName === 'broadcast') return;
      var envelope = inner.payload && typeof inner.payload === 'object' ? inner.payload : {};
      var targetRooms = Array.isArray(envelope.rooms) ? envelope.rooms : [];
      var allowed =
        targetRooms.length === 0 ||
        targetRooms.some(function (room) {
          return rooms[room];
        });
      if (!allowed) return;
      var data = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
      fire(eventName, data);
    }

    function connect() {
      if (closedByUser) return;
      if (!cfg.supabaseUrl || !cfg.anonKey || typeof WebSocket !== 'function') {
        fire('connect_error', new Error('Realtime is not configured'));
        return;
      }
      var httpBase = String(cfg.supabaseUrl).replace(/\\/+$/, '');
      var wsBase = httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
      var url =
        wsBase +
        '/realtime/v1/websocket?apikey=' +
        encodeURIComponent(cfg.anonKey) +
        '&vsn=1.0.0';
      try {
        ws = new WebSocket(url);
      } catch (error) {
        fire('connect_error', error);
        scheduleReconnect();
        return;
      }
      ws.onopen = function () {
        joinRef = nextRef();
        send(
          'realtime:' + TOPIC,
          'phx_join',
          {
            config: {
              broadcast: { ack: false, self: false },
              presence: { key: '' },
              postgres_changes: [],
              private: false,
            },
            access_token: cfg.anonKey,
          },
          joinRef
        );
        heartbeat = setInterval(function () {
          send('phoenix', 'heartbeat', {}, nextRef());
        }, 25000);
      };
      ws.onmessage = function (message) {
        var frames;
        try {
          frames = JSON.parse(message.data);
        } catch (error) {
          return;
        }
        if (!Array.isArray(frames)) frames = [frames];
        frames.forEach(handleFrame);
      };
      ws.onerror = function () {
        fire('connect_error', new Error('Realtime socket error'));
      };
      ws.onclose = function () {
        cleanup();
        setConnected(false);
        scheduleReconnect();
      };
    }

    connect();
    return socket;
  }

  function io(url, options) {
    if (url && typeof url === 'object') options = url;
    return createSocket(options || {});
  }

  root.io = io;
})(typeof window !== 'undefined' ? window : globalThis);
`;

function renderSocketClient({ supabaseUrl = '', anonKey = '' } = {}) {
  const config = JSON.stringify({
    supabaseUrl: String(supabaseUrl || '').replace(/\/+$/, ''),
    anonKey: String(anonKey || ''),
  });
  return CLIENT_SOURCE.replace('__CONFIG_JSON__', config);
}

module.exports = { renderSocketClient };
