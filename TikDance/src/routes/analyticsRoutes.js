function setupAnalyticsRoutes(app, requireSession) {
    app.get('/api/analytics/resumen', requireSession, (req, res) => {
        try {
            res.json(req.userSession.db.getResumenAnalytics());
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/historial', requireSession, (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 50;
            res.json(req.userSession.db.getHistorialRegalos(limite));
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/top-gifters', requireSession, (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 5;
            res.json(req.userSession.db.getTopGifters(limite));
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/grafica', requireSession, (req, res) => {
        try {
            res.json(req.userSession.db.getRegalosPorDia());
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/grafica-mensual', requireSession, (req, res) => {
        try {
            res.json(req.userSession.db.getRegalosPorMes());
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/meses', requireSession, (req, res) => {
        try {
            const filas = req.userSession.db.getMesesConHistorial();
            const meses = (filas || []).map(f => typeof f === 'string' ? f : (f && f.mes)).filter(Boolean);
            res.json(meses);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/queens-periodo', requireSession, (req, res) => {
        try {
            const periodo = req.query.periodo || 'historico';
            res.json(req.userSession.db.getQueensAnalyticsPorPeriodo(periodo));
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/bailarina', requireSession, (req, res) => {
        try {
            const name = req.query.name || '';
            const periodo = req.query.periodo || 'historico';
            const db = req.userSession.db;
            const stats = db.getDatosBailarina(name, periodo);
            const topDonadores = db.getTopDonadoresBailarina(name, 5, periodo);
            const distribucionRegalos = db.getDistribucionRegalosBailarina(name, periodo);
            const evolucion = db.getEvolucionBailarina(name, periodo);
            res.json({ stats, topDonadores, distribucionRegalos, evolucion });
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/horas-pico', requireSession, (req, res) => {
        try {
            res.json(req.userSession.db.getDonacionesPorHora());
        } catch (e) {
            res.status(500).send(e.message);
        }
    });
}

module.exports = setupAnalyticsRoutes;
