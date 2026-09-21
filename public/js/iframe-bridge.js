/**
 * iframe-bridge.js — Socket.IO Event Bridge for Embedded Iframes
 * 
 * Cuando una página se carga dentro del overlay-universal (iframe),
 * el socket.io del iframe puede fallar en navegadores embebidos (TikTok LIVE Studio CEF).
 * 
 * Este script:
 * 1. Detecta si la página está dentro de un iframe
 * 2. Si está en iframe: crea un socket puente que recibe eventos vía postMessage
 *    desde overlay-universal.html (que SÍ tiene conexión socket real).
 * 3. Si NO está en iframe: no hace nada (se usa el socket real normal).
 * 
 * Uso en los HTML: 
 *   <script src="/js/iframe-bridge.js"></script>
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script>
 *     const socket = window.__iframeBridgeSocket || io({ query: ... });
 *   </script>
 */
(function() {
    // Solo activar si estamos dentro de un iframe
    if (window.parent === window) return;

    var listeners = {};

    var bridgeSocket = {
        connected: false,
        id: 'iframe-bridge',
        on: function(event, fn) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
            if (event === 'connect' && bridgeSocket.connected) {
                try { fn(); } catch(e) {}
            }
        },
        off: function(event, fn) {
            if (!listeners[event]) return;
            if (fn) {
                listeners[event] = listeners[event].filter(function(f) { return f !== fn; });
            } else {
                delete listeners[event];
            }
        },
        emit: function(event, data) {
            try {
                window.parent.postMessage({
                    type: 'SOCKET_IO_EMIT',
                    event: event,
                    data: data
                }, '*');
            } catch(e) {}
        },
        connect: function() {},
        disconnect: function() {}
    };

    function trigger(event, data) {
        if (listeners[event]) {
            for (var i = 0; i < listeners[event].length; i++) {
                try {
                    listeners[event][i](data);
                } catch(err) {
                    console.error('[iframe-bridge] Error handling event "' + event + '":', err);
                }
            }
        }
    }

    // Escuchar mensajes del padre (overlay-universal.html / overlay-acumulados.html)
    window.addEventListener('message', function(e) {
        if (!e.data || !e.data.type) return;

        if (e.data.type === 'SOCKET_IO_EVENT' || e.data.type === 'socket-event') {
            trigger(e.data.event, e.data.data);
        } else if (e.data.type === 'SOCKET_IO_CONNECT') {
            var wasConnected = bridgeSocket.connected;
            bridgeSocket.connected = !!e.data.connected;
            if (bridgeSocket.connected && !wasConnected) {
                trigger('connect');
            } else if (!bridgeSocket.connected && wasConnected) {
                trigger('disconnect');
            }
        }
    });

    // Notificar al contenedor padre que el puente está listo
    try {
        window.parent.postMessage({ type: 'IFRAME_BRIDGE_READY' }, '*');
    } catch(e) {}

    // Exponer globalmente
    window.__iframeBridgeSocket = bridgeSocket;
})();
