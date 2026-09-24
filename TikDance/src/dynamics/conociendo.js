function setupConociendoDynamics(app, io, requireSession, activeSessions) {
    function saltarConociendo(username, chicaEspecifica = null) {
        const session = activeSessions[username];
        if (!session) return;
        if (session.conociendo.orden.length === 0) session.conociendo.orden = [...session.QUEENS];
        if (chicaEspecifica) session.conociendo.chicaActual = chicaEspecifica;
        else {
            let idx = session.conociendo.orden.indexOf(session.conociendo.chicaActual);
            session.conociendo.chicaActual = session.conociendo.orden[(idx + 1) % session.conociendo.orden.length];
        }
        session.conociendo.estado = 'transicion';
        session.conociendo.tiempoTransicion = 5;
        session.conociendo.puntos = 0;
        io.to(username).emit('conociendoTransicion', { chica: session.conociendo.chicaActual, tiempo: session.conociendo.tiempoTransicion });
    }

    app.all('/conociendo/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        s.conociendo.orden = [...s.QUEENS];
        s.conociendo.activo = true;
        s.conociendo.meta = parseInt(req.query.meta) || 2000;
        s.conociendo.titulo = req.query.titulo || s.conociendo.titulo || 'CONOCIENDO A:';
        s.conociendo.tiempo = 300;
        s.conociendo.puntos = 0;
        s.conociendo.chicaActual = s.QUEENS[0] || '';
        s.conociendo.estado = 'activo';
        let subTickConociendo = 0;
        let snipeConociendo = 3;
        clearInterval(s.intervaloConociendo);
        
        io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos, titulo: s.conociendo.titulo });
        
        s.intervaloConociendo = setInterval(() => {
            if (s.conociendo.estado === 'transicion') {
                s.conociendo.tiempoTransicion--;
                io.to(user).emit('conociendoTransicionTick', s.conociendo.tiempoTransicion);
                if (s.conociendo.tiempoTransicion <= 0) {
                    s.conociendo.estado = 'activo';
                    s.conociendo.tiempo = 300;
                    snipeConociendo = 3;
                    subTickConociendo = 0;
                    io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos, titulo: s.conociendo.titulo });
                }
            } else if (s.conociendo.estado === 'activo') {
                if (s.conociendo.tiempo > 3) {
                    s.conociendo.tiempo--;
                    io.to(user).emit('conociendoTick', s.conociendo.tiempo);
                } else if (s.conociendo.tiempo > 0) {
                    subTickConociendo++;
                    if (subTickConociendo >= 2) {
                        s.conociendo.tiempo--;
                        subTickConociendo = 0;
                    }
                    io.to(user).emit('conociendoTick', s.conociendo.tiempo);
                } else {
                    io.to(user).emit('conociendoTick', 0);
                    snipeConociendo--;
                    if (snipeConociendo <= 0) {
                        if (s.conociendo.puntos >= s.conociendo.meta) {
                            s.conociendo.tiempo = 300;
                            s.conociendo.puntos = 0;
                            io.to(user).emit('conociendoInicio', { chica: s.conociendo.chicaActual, tiempo: s.conociendo.tiempo, meta: s.conociendo.meta, puntos: s.conociendo.puntos, titulo: s.conociendo.titulo });
                        } else {
                            saltarConociendo(user);
                        }
                        snipeConociendo = 3;
                        subTickConociendo = 0;
                    }
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
        if (s.conociendo.activo) saltarConociendo(req.username, target);
        res.send("OK");
    });

    app.all('/conociendo/status', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({
            activo: !!(s.conociendo && s.conociendo.activo),
            chica: s.conociendo ? s.conociendo.chicaActual : '',
            tiempo: s.conociendo ? s.conociendo.tiempo : 300,
            meta: s.conociendo ? s.conociendo.meta : 2000,
            puntos: s.conociendo ? s.conociendo.puntos : 0,
            titulo: (s.conociendo && s.conociendo.titulo) || 'CONOCIENDO A:',
            estado: s.conociendo ? s.conociendo.estado : 'inactivo'
        });
    });

    return { saltarConociendo };
}

module.exports = setupConociendoDynamics;
