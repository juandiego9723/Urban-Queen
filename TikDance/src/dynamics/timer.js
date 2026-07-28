function setupTimerDynamics(app, io, requireSession, activeSessions) {
    function saltarSiguienteChica(username, chicaEspecifica = null) {
        const session = activeSessions[username];
        if (!session) return;
        if (session.timerBaile.orden.length === 0) session.timerBaile.orden = [...session.QUEENS];
        if (chicaEspecifica) session.timerBaile.chicaActual = chicaEspecifica;
        else {
            let idx = session.timerBaile.orden.indexOf(session.timerBaile.chicaActual);
            session.timerBaile.chicaActual = session.timerBaile.orden[(idx + 1) % session.timerBaile.orden.length];
        }
        session.timerBaile.estado = 'transicion';
        session.timerBaile.tiempoTransicion = 5;
        session.timerBaile.tiempo = 0;
        io.to(username).emit('timerTransicion', { chica: session.timerBaile.chicaActual, tiempo: session.timerBaile.tiempoTransicion });
    }

    app.all('/timer/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const tiempoBase = parseInt(req.query.t) || 30;
        const segundosPorMoneda = parseInt(req.query.s) || 3;
        
        s.timerBaile.orden = [...s.QUEENS];
        s.timerBaile.activo = true;
        s.timerBaile.tiempo = tiempoBase;
        s.timerBaile.segundosPorMoneda = segundosPorMoneda;
        s.timerBaile.chicaActual = s.QUEENS[0] || 'Ray';
        s.timerBaile.estado = 'bailando';
        s.tiempoAcumulado = {};
        s.QUEENS.forEach(q => s.tiempoAcumulado[q] = 0);
        let subTickBaile = 0;
        let snipeBaile = 3;
        clearInterval(s.intervaloTimerBaile);
        
        io.to(user).emit('timerInicio', {
            chica: s.timerBaile.chicaActual,
            tiempo: s.timerBaile.tiempo,
            segundosPorMoneda: s.timerBaile.segundosPorMoneda
        });
        
        s.intervaloTimerBaile = setInterval(() => {
            if (s.timerBaile.estado === 'transicion') {
                s.timerBaile.tiempoTransicion--;
                io.to(user).emit('timerTransicionTick', s.timerBaile.tiempoTransicion);
                if (s.timerBaile.tiempoTransicion <= 0) {
                    s.timerBaile.estado = 'bailando';
                    s.timerBaile.tiempo += tiempoBase;
                    snipeBaile = 3;
                    subTickBaile = 0;
                    io.to(user).emit('timerInicio', { chica: s.timerBaile.chicaActual, tiempo: s.timerBaile.tiempo });
                }
            } else if (s.timerBaile.estado === 'bailando') {
                s.tiempoAcumulado[s.timerBaile.chicaActual] = (s.tiempoAcumulado[s.timerBaile.chicaActual] || 0) + 1;
                io.to(user).emit('timerAcumulado', s.tiempoAcumulado);
                if (s.timerBaile.tiempo > 3) {
                    s.timerBaile.tiempo--;
                    io.to(user).emit('timerTick', s.timerBaile.tiempo);
                } else if (s.timerBaile.tiempo > 0) {
                    subTickBaile++;
                    if (subTickBaile >= 2) {
                        s.timerBaile.tiempo--;
                        subTickBaile = 0;
                    }
                    io.to(user).emit('timerTick', s.timerBaile.tiempo);
                } else {
                    io.to(user).emit('timerTick', 0);
                    snipeBaile--;
                    if (snipeBaile <= 0) {
                        saltarSiguienteChica(user);
                        snipeBaile = 3;
                        subTickBaile = 0;
                    }
                }
            }
        }, 1000);
        res.send("OK");
    });

    app.all('/timer/stop', requireSession, (req, res) => {
        const s = req.userSession;
        s.timerBaile.activo = false;
        s.timerBaile.estado = 'inactivo';
        clearInterval(s.intervaloTimerBaile);
        io.to(req.username).emit('timerCancelado');
        res.send("OK");
    });

    app.all('/timer/skip', requireSession, (req, res) => {
        const s = req.userSession;
        let target = req.query.c;
        if (s.timerBaile.activo) saltarSiguienteChica(req.username, target || null);
        res.send("OK");
    });

    return { saltarSiguienteChica };
}

module.exports = setupTimerDynamics;
