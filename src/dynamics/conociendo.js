function setupConociendoDynamics(app, io, requireSession, activeSessions) {
    function saltarConociendo(username, chicaEspecifica = null) {
        const session = activeSessions[username];
        if (!session) return;
        if (!session.conociendo.orden || session.conociendo.orden.length === 0) {
            session.conociendo.orden = [...session.QUEENS];
        }
        if (chicaEspecifica) {
            session.conociendo.chicaActual = chicaEspecifica;
        } else {
            let idx = session.conociendo.orden.indexOf(session.conociendo.chicaActual);
            session.conociendo.chicaActual = session.conociendo.orden[(idx + 1) % session.conociendo.orden.length];
        }
        session.conociendo.estado = 'activo';
        session.conociendo.tiempo = session.conociendo.tiempoInicial || 300;
        session.conociendo.puntos = 0;
        io.to(username).emit('conociendoInicio', { 
            chica: session.conociendo.chicaActual, 
            tiempo: session.conociendo.tiempo, 
            meta: session.conociendo.meta, 
            puntos: session.conociendo.puntos, 
            titulo: session.conociendo.titulo 
        });
        io.to(username).emit('conociendoPuntos', {
            puntos: session.conociendo.puntos,
            meta: session.conociendo.meta
        });
        io.to(username).emit('conociendoRankingActualizado', {
            puntosRanking: session.conociendo.puntosRanking || {},
            eliminadas: session.conociendo.eliminadas || []
        });
    }

    app.all('/conociendo/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        s.conociendo.orden = [...s.QUEENS];
        s.conociendo.activo = true;
        s.conociendo.meta = parseInt(req.query.meta) || 2000;
        s.conociendo.titulo = (req.query.titulo !== undefined && req.query.titulo !== '') ? req.query.titulo : 'Winner : Special Solo Dance';
        s.conociendo.tiempoInicial = parseInt(req.query.tiempo) > 0 ? parseInt(req.query.tiempo) : 300;
        s.conociendo.tiempo = s.conociendo.tiempoInicial;
        s.conociendo.puntos = 0;
        s.conociendo.chicaActual = s.QUEENS[0] || '';
        s.conociendo.estado = 'activo';
        if (!s.conociendo.puntosRanking) s.conociendo.puntosRanking = {};
        if (!s.conociendo.eliminadas) s.conociendo.eliminadas = [];
        
        clearInterval(s.intervaloConociendo);
        
        io.to(user).emit('conociendoInicio', { 
            chica: s.conociendo.chicaActual, 
            tiempo: s.conociendo.tiempo, 
            meta: s.conociendo.meta, 
            puntos: s.conociendo.puntos, 
            titulo: s.conociendo.titulo 
        });
        io.to(user).emit('conociendoPuntos', {
            puntos: s.conociendo.puntos,
            meta: s.conociendo.meta
        });
        io.to(user).emit('conociendoRankingActualizado', {
            puntosRanking: s.conociendo.puntosRanking,
            eliminadas: s.conociendo.eliminadas
        });
        
        s.intervaloConociendo = setInterval(() => {
            if (s.conociendo.estado === 'activo') {
                if (s.conociendo.tiempo > 0) {
                    s.conociendo.tiempo--;
                    io.to(user).emit('conociendoTick', s.conociendo.tiempo);
                } else {
                    io.to(user).emit('conociendoTick', 0);
                }
            }
        }, 1000);
        res.send("OK");
    });

    app.all('/conociendo/stop', requireSession, (req, res) => {
        const s = req.userSession;
        s.conociendo.activo = false;
        s.conociendo.estado = 'inactivo';
        clearInterval(s.intervaloConociendo);
        io.to(req.username).emit('conociendoCancelado');
        res.send("OK");
    });

    app.all('/conociendo/skip', requireSession, (req, res) => {
        const s = req.userSession;
        let target = req.query.c;
        if (s.conociendo.activo) {
            saltarConociendo(req.username, target);
        } else {
            s.conociendo.orden = [...s.QUEENS];
            s.conociendo.activo = true;
            s.conociendo.meta = s.conociendo.meta || 2000;
            s.conociendo.titulo = (s.conociendo.titulo !== undefined && s.conociendo.titulo !== '') ? s.conociendo.titulo : 'Winner : Special Solo Dance';
            s.conociendo.tiempoInicial = s.conociendo.tiempoInicial || 300;
            saltarConociendo(req.username, target);
            clearInterval(s.intervaloConociendo);
            s.intervaloConociendo = setInterval(() => {
                if (s.conociendo.estado === 'activo') {
                    if (s.conociendo.tiempo > 0) {
                        s.conociendo.tiempo--;
                        io.to(req.username).emit('conociendoTick', s.conociendo.tiempo);
                    } else {
                        io.to(req.username).emit('conociendoTick', 0);
                    }
                }
            }, 1000);
        }
        res.send("OK");
    });

    app.all('/conociendo/toggle-out', requireSession, (req, res) => {
        const s = req.userSession;
        const chica = req.query.c;
        if (!chica) return res.send("ERR");
        if (!s.conociendo.eliminadas) s.conociendo.eliminadas = [];
        if (!s.conociendo.puntosRanking) s.conociendo.puntosRanking = {};

        const idx = s.conociendo.eliminadas.indexOf(chica);
        if (idx > -1) {
            s.conociendo.eliminadas.splice(idx, 1);
        } else {
            s.conociendo.eliminadas.push(chica);
        }

        io.to(req.username).emit('conociendoRankingActualizado', {
            puntosRanking: s.conociendo.puntosRanking,
            eliminadas: s.conociendo.eliminadas
        });
        res.send("OK");
    });

    app.all('/conociendo/reset-ranking', requireSession, (req, res) => {
        const s = req.userSession;
        s.conociendo.puntosRanking = {};
        s.conociendo.eliminadas = [];
        s.conociendo.puntos = 0;

        io.to(req.username).emit('conociendoRankingActualizado', {
            puntosRanking: {},
            eliminadas: [],
            action: 'RESET_RANKING_CONOCIENDO'
        });
        io.to(req.username).emit('conociendoPuntos', {
            puntos: 0,
            meta: s.conociendo.meta || 2000
        });
        res.send("OK");
    });

    app.all('/conociendo/sumar-puntos', requireSession, (req, res) => {
        const s = req.userSession;
        const chica = (req.query.c || (req.body && req.body.c) || '').trim();
        const puntos = parseInt(req.query.pts || (req.body && req.body.pts)) || 0;
        if (!chica || puntos === 0) return res.status(400).send("Parámetros c y pts requeridos");
        if (!s.conociendo.puntosRanking) s.conociendo.puntosRanking = {};
        if (!s.conociendo.eliminadas) s.conociendo.eliminadas = [];

        s.conociendo.puntosRanking[chica] = Math.max(0, (s.conociendo.puntosRanking[chica] || 0) + puntos);
        if (s.conociendo.chicaActual === chica) {
            s.conociendo.puntos = Math.max(0, (s.conociendo.puntos || 0) + puntos);
            io.to(req.username).emit('conociendoPuntos', {
                puntos: s.conociendo.puntos,
                meta: s.conociendo.meta || 2000
            });
        }

        io.to(req.username).emit('conociendoRankingActualizado', {
            puntosRanking: s.conociendo.puntosRanking,
            eliminadas: s.conociendo.eliminadas
        });

        res.json({
            status: "OK",
            chica,
            puntosActuales: s.conociendo.puntosRanking[chica],
            puntosRanking: s.conociendo.puntosRanking
        });
    });

    app.get('/api/conociendo-estado', requireSession, (req, res) => {
        const s = req.userSession;
        if (!s.conociendo.eliminadas) s.conociendo.eliminadas = [];
        if (!s.conociendo.puntosRanking) s.conociendo.puntosRanking = {};
        res.json({
            activo: !!s.conociendo.activo,
            estado: s.conociendo.estado || 'inactivo',
            chicaActual: s.conociendo.chicaActual || '',
            tiempo: s.conociendo.tiempo !== undefined ? s.conociendo.tiempo : 300,
            meta: s.conociendo.meta || 2000,
            puntos: s.conociendo.puntos || 0,
            titulo: s.conociendo.titulo || 'Conociendo a mi Queen',
            puntosRanking: s.conociendo.puntosRanking,
            eliminadas: s.conociendo.eliminadas
        });
    });

    app.get('/api/conociendo-ranking', requireSession, (req, res) => {
        const s = req.userSession;
        if (!s.conociendo.eliminadas) s.conociendo.eliminadas = [];
        if (!s.conociendo.puntosRanking) s.conociendo.puntosRanking = {};
        const queensList = (s.conociendo.orden && s.conociendo.orden.length > 0) ? s.conociendo.orden : (s.QUEENS || []);
        res.json({
            puntosRanking: s.conociendo.puntosRanking,
            eliminadas: s.conociendo.eliminadas,
            queens: queensList,
            apodos: s.db.getApodosMap()
        });
    });

    return { saltarConociendo };
}

module.exports = setupConociendoDynamics;
