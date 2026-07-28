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
}

module.exports = setupAnalyticsRoutes;
