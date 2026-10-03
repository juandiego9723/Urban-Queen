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
    }

    app.all('/conociendo/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        s.conociendo.orden = [...s.QUEENS];
        s.conociendo.activo = true;
        s.conociendo.meta = parseInt(req.query.meta) || 2000;
        s.conociendo.titulo = req.query.titulo !== undefined ? req.query.titulo : 'CONOCIENDO A:';
        s.conociendo.tiempoInicial = parseInt(req.query.tiempo) > 0 ? parseInt(req.query.tiempo) : 300;
        s.conociendo.tiempo = s.conociendo.tiempoInicial;
        s.conociendo.puntos = 0;
        s.conociendo.chicaActual = s.QUEENS[0] || '';
        s.conociendo.estado = 'activo';
        
        clearInterval(s.intervaloConociendo);
        
        io.to(user).emit('conociendoInicio', { 
            chica: s.conociendo.chicaActual, 
            tiempo: s.conociendo.tiempo, 
            meta: s.conociendo.meta, 
            puntos: s.conociendo.puntos, 
            titulo: s.conociendo.titulo 
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
            s.conociendo.titulo = s.conociendo.titulo !== undefined ? s.conociendo.titulo : 'CONOCIENDO A:';
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

    return { saltarConociendo };
}

module.exports = setupConociendoDynamics;
