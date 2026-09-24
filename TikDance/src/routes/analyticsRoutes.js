function setupAnalyticsRoutes(app, requireSession) {
    app.get('/api/analytics/resumen', requireSession, (req, res) => {
        try {
            const data = req.userSession.db.getResumenAnalytics();
            res.json(data || { totalHoy: 0, totalMes: 0, totalHistorico: 0 });
        } catch (e) {
            console.error('Error en /api/analytics/resumen:', e);
            res.json({ totalHoy: 0, totalMes: 0, totalHistorico: 0 });
        }
    });

    app.get('/api/analytics/historial', requireSession, (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 50;
            const data = req.userSession.db.getHistorialRegalos(limite);
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/historial:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/top-gifters', requireSession, (req, res) => {
        try {
            const limite = parseInt(req.query.limite) || 5;
            const data = req.userSession.db.getTopGifters(limite);
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/top-gifters:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/grafica', requireSession, (req, res) => {
        try {
            const data = req.userSession.db.getRegalosPorDia();
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/grafica:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/grafica-mensual', requireSession, (req, res) => {
        try {
            const data = req.userSession.db.getRegalosPorMes();
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/grafica-mensual:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/meses', requireSession, (req, res) => {
        try {
            const filas = req.userSession.db.getMesesConHistorial();
            const meses = (filas || []).map(f => typeof f === 'string' ? f : (f && f.mes)).filter(Boolean);
            res.json(meses);
        } catch (e) {
            console.error('Error en /api/analytics/meses:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/queens-periodo', requireSession, (req, res) => {
        try {
            const periodo = req.query.periodo || 'historico';
            const data = req.userSession.db.getQueensAnalyticsPorPeriodo(periodo);
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/queens-periodo:', e);
            res.json([]);
        }
    });

    app.get('/api/analytics/bailarina', requireSession, (req, res) => {
        try {
            const name = req.query.name || '';
            const periodo = req.query.periodo || 'historico';
            const db = req.userSession.db;
            const stats = db.getDatosBailarina(name, periodo) || {};
            const topDonadores = db.getTopDonadoresBailarina(name, 5, periodo) || [];
            const distribucionRegalos = db.getDistribucionRegalosBailarina(name, periodo) || [];
            const evolucion = db.getEvolucionBailarina(name, periodo) || [];
            res.json({ stats, topDonadores, distribucionRegalos, evolucion });
        } catch (e) {
            console.error('Error en /api/analytics/bailarina:', e);
            res.json({ stats: {}, topDonadores: [], distribucionRegalos: [], evolucion: [] });
        }
    });

    app.get('/api/analytics/horas-pico', requireSession, (req, res) => {
        try {
            const data = req.userSession.db.getDonacionesPorHora();
            res.json(data || []);
        } catch (e) {
            console.error('Error en /api/analytics/horas-pico:', e);
            res.json([]);
        }
    });
}

module.exports = setupAnalyticsRoutes;
