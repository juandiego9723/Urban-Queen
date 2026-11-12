const { checkIsCosmic } = require('../utils/agencyUtils');
const {
    setGoleadoresConfig,
    obtenerTopGoleadores,
    emitirEstadoGoleadores,
    reiniciarGoleadoresMes
} = require('../services/clasicoGoleadoresService');

function setupFutbolDynamics(app, io, requireSession) {
    app.get('/api/futbol/config', requireSession, (req, res) => {
        res.json(req.userSession.db.getFutbolConfig());
    });

    app.post('/api/futbol/config', requireSession, async (req, res) => {
        const s = req.userSession;
        const config = req.body;
        if (!config || !config.equipo1 || !config.equipo2) return res.status(400).send('Invalid config');
        await s.db.setFutbolConfig(config);
        io.to(req.username).emit('futbolConfigActualizada', config);
        if (checkIsCosmic(req, s)) {
            await emitirEstadoGoleadores(s, io);
        }
        res.send('OK');
    });

    // ── Máximos Goleadores Mensuales de El Clásico (Exclusivo Cosmic) ──
    app.get('/api/futbol/goleadores', requireSession, async (req, res) => {
        const s = req.userSession;
        if (!checkIsCosmic(req, s)) {
            return res.status(403).json({ error: 'Funcionalidad exclusiva para Cosmic' });
        }
        try {
            const limite = parseInt(req.query.limit, 10) || 3;
            const mesKey = req.query.mes ? String(req.query.mes).trim() : null;
            const payload = await obtenerTopGoleadores(s, limite, mesKey);
            res.json(payload);
        } catch (err) {
            console.error('[Futbol] Error obteniendo goleadores:', err.message);
            res.status(500).json({ error: 'Error al consultar goleadores' });
        }
    });

    app.post('/api/futbol/goleadores/config', requireSession, async (req, res) => {
        const s = req.userSession;
        if (!checkIsCosmic(req, s)) {
            return res.status(403).json({ error: 'Funcionalidad exclusiva para Cosmic' });
        }
        try {
            const cfg = await setGoleadoresConfig(s, req.body || {});
            await emitirEstadoGoleadores(s, io);
            res.json({ status: 'OK', config: cfg });
        } catch (err) {
            console.error('[Futbol] Error guardando config de goleadores:', err.message);
            res.status(500).json({ error: 'Error al guardar configuración' });
        }
    });

    app.post('/api/futbol/goleadores/reset', requireSession, async (req, res) => {
        const s = req.userSession;
        if (!checkIsCosmic(req, s)) {
            return res.status(403).json({ error: 'Funcionalidad exclusiva para Cosmic' });
        }
        try {
            const equipo = (req.body && req.body.equipo !== undefined) ? req.body.equipo : req.query.equipo;
            const result = await reiniciarGoleadoresMes({
                session: s,
                io,
                equipo: equipo || null
            });
            res.json({ status: 'OK', ...result });
        } catch (err) {
            console.error('[Futbol] Error reiniciando goleadores:', err.message);
            res.status(500).json({ error: 'Error al reiniciar goleadores' });
        }
    });

    app.all('/futbol/reglas', requireSession, (req, res) => {
        const s = req.userSession;
        if (req.query.fa) {
            s.configFutbol.limiteAmarilla = parseInt(req.query.fa);
            s.db.setConfigVal('limiteAmarilla', s.configFutbol.limiteAmarilla);
        }
        res.send("OK");
    });

    app.all('/futbol/reset-tarjetas', requireSession, (req, res) => {
        const s = req.userSession;
        s.QUEENS.forEach(q => { s.rachasPerdidas[q] = 0; s.amarillasAcumuladas[q] = 0; });
        io.to(req.username).emit('resetTarjetas');
        res.send("OK");
    });
}

module.exports = setupFutbolDynamics;
