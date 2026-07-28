function setupFutbolDynamics(app, io, requireSession) {
    app.get('/api/futbol/config', requireSession, (req, res) => {
        res.json(req.userSession.db.getFutbolConfig());
    });

    app.post('/api/futbol/config', requireSession, (req, res) => {
        const s = req.userSession;
        const config = req.body;
        if (!config || !config.equipo1 || !config.equipo2) return res.status(400).send('Invalid config');
        s.db.setFutbolConfig(config);
        io.to(req.username).emit('futbolConfigActualizada', config);
        res.send('OK');
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
