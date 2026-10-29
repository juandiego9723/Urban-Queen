const DIRECCIONES = ['izquierda', 'centro', 'derecha'];

const CONFIG_DEFAULT = {
    activo: true,
    regalo: '',
    regaloPts: 0,
    maxRepeticiones: 5,
    autoDescartarSeg: 30
};

function setupPenaltiDynamics(app, io, requireSession, activeSessions) {
    function leerConfig(session) {
        try {
            const raw = session.db.getConfigVal('penalti_config');
            return { ...CONFIG_DEFAULT, ...(raw ? JSON.parse(raw) : {}) };
        } catch (e) {
            return { ...CONFIG_DEFAULT };
        }
    }

    function estadoSesion(session) {
        if (!session.penalti) session.penalti = { cola: [], actual: null, timer: null, seq: 0 };
        return session.penalti;
    }

    function coincideRegalo(config, giftName, giftId) {
        const objetivo = String(config.regalo || '').trim().toLowerCase();
        if (!objetivo) return false;
        const nombre = String(giftName || '').trim().toLowerCase();
        const gid = giftId ? String(giftId).trim() : '';
        return (nombre && nombre === objetivo) ||
            (gid && (gid === objetivo || `id:${gid}` === objetivo));
    }

    function lanzarSiguiente(username) {
        const session = activeSessions[username];
        if (!session) return;
        const st = estadoSesion(session);
        if (st.actual || st.cola.length === 0) return;

        const config = leerConfig(session);
        st.actual = st.cola.shift();
        io.to(username).emit('penaltiLanzado', { ...st.actual, pendientes: st.cola.length });

        const seg = parseInt(config.autoDescartarSeg) || 0;
        clearTimeout(st.timer);
        if (seg > 0) {
            const idTiro = st.actual.id;
            st.timer = setTimeout(() => cerrarTiro(username, idTiro, 'descartado', null), seg * 1000);
        }
    }

    function cerrarTiro(username, id, resultado, destino) {
        const session = activeSessions[username];
        if (!session) return false;
        const st = estadoSesion(session);
        if (!st.actual || st.actual.id !== id) return false;

        clearTimeout(st.timer);
        const tiro = st.actual;
        st.actual = null;

        let puntos = 0;
        if (resultado === 'gol' || resultado === 'atajada') {
            const config = leerConfig(session);
            // Gol y atajada valen lo mismo que el regalo configurado (no editable)
            puntos = parseInt(tiro.puntos) || parseInt(config.regaloPts) || 0;
            if (puntos > 0 && destino && session.QUEENS.includes(destino)) {
                const eq = session.equipos[destino] || {};

                // 1. Sumar a rankings generales y persistir en base de datos
                if (session.db && typeof session.db.sumarPuntos === 'function') {
                    session.db.sumarPuntos(destino, puntos);
                }
                try {
                    if (session.db && typeof session.db.registrarRegalo === 'function') {
                        session.db.registrarRegalo(destino, `Penalti (${resultado})`, puntos, tiro.viewer || 'Penalti');
                    }
                } catch (e) { }

                // 2. Sumar directamente al marcador de El Clásico (Batalla de Fútbol)
                if (!session.puntosBatalla) session.puntosBatalla = {};
                session.puntosBatalla[destino] = (session.puntosBatalla[destino] || 0) + puntos;

                // 3. Emitir actualización inmediata a los overlays de El Clásico y ranking general
                io.to(username).emit('batallaPuntos', session.puntosBatalla);
                if (session.db && typeof session.db.getCopa === 'function') {
                    io.to(username).emit('actualizarCopa', session.db.getCopa());
                }
                if (session.db) {
                    try {
                        io.to(username).emit('rankingActualizado', {
                            semanal: typeof session.db.getRanking === 'function' ? session.db.getRanking() : {},
                            mensual: typeof session.db.getRankingMensual === 'function' ? session.db.getRankingMensual() : {},
                            diario: typeof session.db.getRankingDiario === 'function' ? session.db.getRankingDiario() : {}
                        });
                    } catch (e) { }
                }
            } else {
                puntos = 0;
            }
        }

        io.to(username).emit('penaltiResultado', { id, resultado, destino: destino || null, puntos, direccion: tiro.direccion });
        // Dejar tiempo a la animación de resultado antes del siguiente tiro
        setTimeout(() => lanzarSiguiente(username), 4500);
        return true;
    }

    function encolar(username, datos, cantidad) {
        const session = activeSessions[username];
        if (!session) return 0;
        const config = leerConfig(session);
        const st = estadoSesion(session);
        const tope = Math.max(1, parseInt(config.maxRepeticiones) || 1);
        const n = Math.min(Math.max(1, parseInt(cantidad) || 1), tope);
        for (let i = 0; i < n; i++) {
            st.seq++;
            st.cola.push({
                id: `penalti-${Date.now()}-${st.seq}`,
                direccion: datos.direccion || DIRECCIONES[Math.floor(Math.random() * DIRECCIONES.length)],
                viewer: datos.viewer || '',
                avatar: datos.avatar || '',
                giftImg: datos.giftImg || '',
                puntos: parseInt(datos.puntos) || 0
            });
        }
        lanzarSiguiente(username);
        return n;
    }

    // Llamado desde pointsProcessor por cada regalo recibido
    function onGift(username, { giftName, giftId, viewer, avatar, repeat, giftImg, diamondUnit }) {
        const session = activeSessions[username];
        if (!session) return;
        const config = leerConfig(session);
        if (!config.activo || !coincideRegalo(config, giftName, giftId)) return;
        encolar(username, { viewer, avatar, giftImg, puntos: diamondUnit }, repeat);
    }

    app.get('/api/penalti/config', requireSession, (req, res) => {
        res.json(leerConfig(req.userSession));
    });

    app.post('/api/penalti/config', requireSession, (req, res) => {
        const s = req.userSession;
        const body = req.body || {};
        const config = {
            activo: body.activo !== false,
            regalo: String(body.regalo || '').trim(),
            regaloPts: Math.max(0, parseInt(body.regaloPts) || 0),
            maxRepeticiones: Math.min(20, Math.max(1, parseInt(body.maxRepeticiones) || CONFIG_DEFAULT.maxRepeticiones)),
            autoDescartarSeg: Math.max(0, parseInt(body.autoDescartarSeg) || 0)
        };
        s.db.setConfigVal('penalti_config', JSON.stringify(config));
        io.to(req.username).emit('penaltiConfigActualizada', config);
        res.send('OK');
    });

    app.get('/api/penalti/estado', requireSession, (req, res) => {
        const st = estadoSesion(req.userSession);
        res.json({ actual: st.actual, pendientes: st.cola.length });
    });

    app.all('/penalti/resolver', requireSession, (req, res) => {
        const body = req.body || {};
        const id = req.query.id || body.id;
        const resultado = String(req.query.resultado || body.resultado || '').toLowerCase();
        const destino = req.query.destino || body.destino || null;
        if (!['gol', 'atajada', 'descartado'].includes(resultado)) return res.status(400).send('Resultado inválido');
        const ok = cerrarTiro(req.username, id, resultado, destino);
        if (!ok) return res.status(404).send('No hay un tiro activo con ese id');
        res.send('OK');
    });

    app.all('/penalti/probar', requireSession, (req, res) => {
        const dir = String(req.query.dir || (req.body && req.body.dir) || '').toLowerCase();
        const cantidad = parseInt(req.query.n || (req.body && req.body.n)) || 1;
        const n = encolar(req.username, {
            direccion: DIRECCIONES.includes(dir) ? dir : null,
            viewer: 'Tester',
            avatar: ''
        }, cantidad);
        res.send(`OK (${n})`);
    });

    return { onGift };
}

module.exports = setupPenaltiDynamics;
