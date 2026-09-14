function setupAnalyticsRoutes(app, requireSession) {
    app.get('/api/analytics/resumen', requireSession, async (req, res) => {
        try {
            const data = await req.userSession.db.getResumenAnalytics();
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/historial', requireSession, async (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 50;
            const data = await req.userSession.db.getHistorialRegalos(limite);
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/top-gifters', requireSession, async (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 5;
            const data = await req.userSession.db.getTopGifters(limite);
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/grafica', requireSession, async (req, res) => {
        try {
            const data = await req.userSession.db.getRegalosPorDia();
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/grafica-mensual', requireSession, async (req, res) => {
        try {
            const data = await req.userSession.db.getRegalosPorMes();
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/meses', requireSession, async (req, res) => {
        try {
            const filas = await req.userSession.db.getMesesConHistorial();
            const meses = (filas || []).map(f => typeof f === 'string' ? f : (f && f.mes)).filter(Boolean);
            res.json(meses);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/queens-periodo', requireSession, async (req, res) => {
        try {
            const periodo = req.query.periodo || 'historico';
            const data = await req.userSession.db.getQueensAnalyticsPorPeriodo(periodo);
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/bailarina', requireSession, async (req, res) => {
        try {
            const name = req.query.name || '';
            const periodo = req.query.periodo || 'historico';
            const db = req.userSession.db;
            const stats = await db.getDatosBailarina(name, periodo);
            const topDonadores = await db.getTopDonadoresBailarina(name, 5, periodo);
            const distribucionRegalos = await db.getDistribucionRegalosBailarina(name, periodo);
            const evolucion = await db.getEvolucionBailarina(name, periodo);
            res.json({ stats, topDonadores, distribucionRegalos, evolucion });
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/api/analytics/horas-pico', requireSession, async (req, res) => {
        try {
            const data = await req.userSession.db.getDonacionesPorHora();
            res.json(data);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });
}

module.exports = setupAnalyticsRoutes;
