function setupPodioDynamics(app, io, requireSession, activeSessions) {
    function ensurePodioState(s) {
        if (!s.podio) {
            s.podio = {
                activo: false,
                tiempo: 0,
                chicaActual: '',
                orden: [...(s.QUEENS || [])],
                estado: 'inactivo',
                tiempoTransicion: 0,
                meta: 2000,
                puntos: 0,
                puntosRanking: {},
                eliminadas: []
            };
        }
        if (!s.podio.eliminadas) s.podio.eliminadas = [];
        if (!s.podio.puntosRanking) s.podio.puntosRanking = {};
    }

    function saltarPodio(username, chicaEspecifica = null, nuevaMeta = null, nuevoTiempo = null, nuevoTitulo = null) {
        const session = activeSessions[username];
        if (!session) return;
        ensurePodioState(session);
        if (!session.podio.orden || session.podio.orden.length === 0) {
            session.podio.orden = [...session.QUEENS];
        }

        const ordenValido = session.podio.orden.filter(q => !session.podio.eliminadas.includes(q));

        if (chicaEspecifica) {
            session.podio.chicaActual = chicaEspecifica;
        } else if (ordenValido.length > 0) {
            let idx = ordenValido.indexOf(session.podio.chicaActual);
            session.podio.chicaActual = ordenValido[(idx + 1) % ordenValido.length];
        } else {
            let idx = session.podio.orden.indexOf(session.podio.chicaActual);
            session.podio.chicaActual = session.podio.orden[(idx + 1) % session.podio.orden.length];
        }

        if (nuevaMeta !== null && !isNaN(parseInt(nuevaMeta)) && parseInt(nuevaMeta) > 0) {
            session.podio.meta = parseInt(nuevaMeta);
        }
        if (nuevoTiempo !== null && !isNaN(parseInt(nuevoTiempo)) && parseInt(nuevoTiempo) > 0) {
            session.podio.tiempoInicial = parseInt(nuevoTiempo);
        }
        if (nuevoTitulo !== null && nuevoTitulo !== undefined && nuevoTitulo !== '') {
            session.podio.titulo = nuevoTitulo;
        }

        session.podio.estado = 'activo';
        session.podio.tiempo = session.podio.tiempoInicial || 300;
        session.podio.puntos = 0;
        io.to(username).emit('podioInicio', { 
            chica: session.podio.chicaActual, 
            tiempo: session.podio.tiempo, 
            meta: session.podio.meta, 
            puntos: session.podio.puntos, 
            titulo: session.podio.titulo 
        });
        io.to(username).emit('podioPuntos', {
            puntos: session.podio.puntos,
            meta: session.podio.meta
        });
        io.to(username).emit('podioRankingActualizado', {
            chicaActual: session.podio.chicaActual || '',
            puntosRanking: session.podio.puntosRanking || {},
            eliminadas: session.podio.eliminadas || []
        });
    }

    app.all('/podio/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        ensurePodioState(s);
        s.podio.orden = [...s.QUEENS];
        s.podio.activo = true;
        s.podio.meta = parseInt(req.query.meta) || 2000;
        s.podio.titulo = (req.query.titulo !== undefined && req.query.titulo !== '') ? req.query.titulo : 'Podio';
        s.podio.tiempoInicial = parseInt(req.query.tiempo) > 0 ? parseInt(req.query.tiempo) : 300;
        s.podio.tiempo = s.podio.tiempoInicial;
        s.podio.puntos = 0;

        const ordenValido = s.podio.orden.filter(q => !s.podio.eliminadas.includes(q));
        const chicaTarget = req.query.c || req.query.chica;
        if (chicaTarget) {
            s.podio.chicaActual = chicaTarget;
            const elIdx = s.podio.eliminadas.indexOf(chicaTarget);
            if (elIdx > -1) s.podio.eliminadas.splice(elIdx, 1);
        } else if (ordenValido.length > 0) {
            s.podio.chicaActual = ordenValido[0];
        } else {
            s.podio.chicaActual = s.QUEENS[0] || '';
        }

        s.podio.estado = 'activo';
        
        clearInterval(s.intervaloPodio);
        
        io.to(user).emit('podioInicio', { 
            chica: s.podio.chicaActual, 
            tiempo: s.podio.tiempo, 
            meta: s.podio.meta, 
            puntos: s.podio.puntos, 
            titulo: s.podio.titulo 
        });
        io.to(user).emit('podioPuntos', {
            puntos: s.podio.puntos,
            meta: s.podio.meta
        });
        io.to(user).emit('podioRankingActualizado', {
            chicaActual: s.podio.chicaActual || '',
            puntosRanking: s.podio.puntosRanking,
            eliminadas: s.podio.eliminadas
        });
        
        s.intervaloPodio = setInterval(() => {
            if (s.podio.estado === 'activo') {
                if (s.podio.tiempo > 0) {
                    s.podio.tiempo--;
                    io.to(user).emit('podioTick', s.podio.tiempo);
                } else {
                    io.to(user).emit('podioTick', 0);
                }
            }
        }, 1000);
        res.send("OK");
    });

    app.all('/podio/stop', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        s.podio.activo = false;
        s.podio.estado = 'inactivo';
        clearInterval(s.intervaloPodio);
        io.to(req.username).emit('podioCancelado');
        res.send("OK");
    });

    app.all('/podio/skip', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        let target = req.query.c || req.query.chica;
        if (target && s.podio.eliminadas) {
            const elIdx = s.podio.eliminadas.indexOf(target);
            if (elIdx > -1) s.podio.eliminadas.splice(elIdx, 1);
        }
        let nuevaMeta = null;
        let nuevoTiempo = null;
        let nuevoTitulo = null;

        if (req.query.meta !== undefined && req.query.meta !== '') {
            const m = parseInt(req.query.meta);
            if (!isNaN(m) && m > 0) {
                nuevaMeta = m;
                s.podio.meta = m;
            }
        }
        if (req.query.tiempo !== undefined && req.query.tiempo !== '') {
            const t = parseInt(req.query.tiempo);
            if (!isNaN(t) && t > 0) {
                nuevoTiempo = t;
                s.podio.tiempoInicial = t;
            }
        }
        if (req.query.titulo !== undefined && req.query.titulo !== '') {
            nuevoTitulo = req.query.titulo;
            s.podio.titulo = req.query.titulo;
        }

        if (s.podio.activo) {
            saltarPodio(req.username, target, nuevaMeta, nuevoTiempo, nuevoTitulo);
        } else {
            s.podio.orden = [...s.QUEENS];
            s.podio.activo = true;
            s.podio.meta = nuevaMeta || s.podio.meta || 2000;
            s.podio.titulo = nuevoTitulo || ((s.podio.titulo !== undefined && s.podio.titulo !== '') ? s.podio.titulo : 'Podio');
            s.podio.tiempoInicial = nuevoTiempo || s.podio.tiempoInicial || 300;
            saltarPodio(req.username, target, nuevaMeta, nuevoTiempo, nuevoTitulo);
            clearInterval(s.intervaloPodio);
            s.intervaloPodio = setInterval(() => {
                if (s.podio.estado === 'activo') {
                    if (s.podio.tiempo > 0) {
                        s.podio.tiempo--;
                        io.to(req.username).emit('podioTick', s.podio.tiempo);
                    } else {
                        io.to(req.username).emit('podioTick', 0);
                    }
                }
            }, 1000);
        }
        res.send("OK");
    });

    app.all('/podio/update-meta', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        const meta = parseInt(req.query.meta || (req.body && req.body.meta));
        if (!isNaN(meta) && meta > 0) {
            s.podio.meta = meta;
            io.to(req.username).emit('podioPuntos', {
                puntos: s.podio.puntos || 0,
                meta: s.podio.meta
            });
            io.to(req.username).emit('podioInicio', {
                chica: s.podio.chicaActual,
                tiempo: s.podio.tiempo,
                meta: s.podio.meta,
                puntos: s.podio.puntos || 0,
                titulo: s.podio.titulo
            });
        }
        res.json({ status: "OK", meta: s.podio.meta });
    });

    app.all('/podio/toggle-out', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        const chica = req.query.c;
        if (!chica) return res.send("ERR");

        const idx = s.podio.eliminadas.indexOf(chica);
        if (idx > -1) {
            s.podio.eliminadas.splice(idx, 1);
        } else {
            s.podio.eliminadas.push(chica);
            if (s.podio.activo && s.podio.chicaActual === chica) {
                const ordenValido = (s.podio.orden || []).filter(q => !s.podio.eliminadas.includes(q));
                if (ordenValido.length > 0) {
                    saltarPodio(req.username);
                    return res.send("OK");
                }
            }
        }

        io.to(req.username).emit('podioRankingActualizado', {
            chicaActual: s.podio.chicaActual || '',
            puntosRanking: s.podio.puntosRanking,
            eliminadas: s.podio.eliminadas
        });
        res.send("OK");
    });

    app.all('/podio/reset-ranking', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        s.podio.puntosRanking = {};
        s.podio.eliminadas = [];
        s.podio.puntos = 0;

        io.to(req.username).emit('podioRankingActualizado', {
            chicaActual: s.podio.chicaActual || '',
            puntosRanking: {},
            eliminadas: [],
            action: 'RESET_RANKING_PODIO'
        });
        io.to(req.username).emit('podioPuntos', {
            puntos: 0,
            meta: s.podio.meta || 2000
        });
        res.send("OK");
    });

    app.all('/podio/sumar-puntos', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        const chica = (req.query.c || (req.body && req.body.c) || '').trim();
        const puntos = parseInt(req.query.pts || (req.body && req.body.pts)) || 0;
        if (!chica || puntos === 0) return res.status(400).send("Parámetros c y pts requeridos");

        s.podio.puntosRanking[chica] = Math.max(0, (s.podio.puntosRanking[chica] || 0) + puntos);
        if (s.podio.chicaActual === chica) {
            s.podio.puntos = Math.max(0, (s.podio.puntos || 0) + puntos);
            io.to(req.username).emit('podioPuntos', {
                puntos: s.podio.puntos,
                meta: s.podio.meta || 2000
            });
        }

        io.to(req.username).emit('podioRankingActualizado', {
            chicaActual: s.podio.chicaActual || '',
            puntosRanking: s.podio.puntosRanking,
            eliminadas: s.podio.eliminadas
        });

        res.json({
            status: "OK",
            chica,
            puntosActuales: s.podio.puntosRanking[chica],
            puntosRanking: s.podio.puntosRanking
        });
    });

    app.get('/api/podio-estado', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        res.json({
            activo: !!s.podio.activo,
            estado: s.podio.estado || 'inactivo',
            chicaActual: s.podio.chicaActual || '',
            tiempo: s.podio.tiempo !== undefined ? s.podio.tiempo : 300,
            meta: s.podio.meta || 2000,
            puntos: s.podio.puntos || 0,
            titulo: s.podio.titulo || 'Podio',
            puntosRanking: s.podio.puntosRanking,
            eliminadas: s.podio.eliminadas
        });
    });

    app.get('/api/podio-ranking', requireSession, (req, res) => {
        const s = req.userSession;
        ensurePodioState(s);
        const queensList = (s.podio.orden && s.podio.orden.length > 0) ? s.podio.orden : (s.QUEENS || []);
        res.json({
            activo: !!s.podio.activo,
            chicaActual: s.podio.chicaActual || '',
            puntosRanking: s.podio.puntosRanking,
            eliminadas: s.podio.eliminadas,
            queens: queensList,
            apodos: s.db.getApodosMap()
        });
    });

    return { saltarPodio };
}

module.exports = setupPodioDynamics;

