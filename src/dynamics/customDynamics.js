function setupCustomDynamics(app, io, requireSession, activeSessions) {
    function resolverParticipantesDinamica(session, participantes) {
        if (!participantes || participantes === 'todas') return [...session.QUEENS];
        if (participantes.startsWith('grupo:')) {
            const grupoId = parseInt(participantes.split(':')[1]);
            const grupo = session.db.getGrupos().find(g => g.id === grupoId);
            return grupo ? grupo.miembros.filter(m => session.QUEENS.includes(m)) : [...session.QUEENS];
        }
        if (participantes.startsWith('manual:')) {
            return participantes.split(':')[1].split(',').map(n => n.trim()).filter(n => session.QUEENS.includes(n));
        }
        return [...session.QUEENS];
    }

    function finalizarDinamica(username) {
        const session = activeSessions[username];
        if (!session || !session.dinamicaActiva) return;
        const activos = session.dinamicaActiva.participantes.filter(p => !session.eliminadosDinamica.includes(p));
        let maxPts = 0;
        activos.forEach(p => { if ((session.puntosDinamica[p] || 0) > maxPts) maxPts = session.puntosDinamica[p] || 0; });
        const ganadoras = activos.filter(p => (session.puntosDinamica[p] || 0) === maxPts);
        const ganadora = ganadoras.length === 1 && maxPts > 0 ? ganadoras[0] : maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE';
        const payload = { ganadora, puntos: session.puntosDinamica, eliminados: session.eliminadosDinamica };
        io.to(username).emit('dinamicaFin', payload);
        setTimeout(() => io.to(username).emit('dinamicaFin', payload), 300);
        session.dinamicaActiva = null;
    }

    // CRUD Dinámicas
    app.get('/api/dinamicas', requireSession, (req, res) => res.json(req.userSession.db.getDinamicas()));

    app.all('/api/dinamicas/crear', requireSession, (req, res) => {
        const s = req.userSession;
        const body = req.body || {};
        const data = {
            nombre: body.nombre,
            descripcion: body.descripcion || '',
            icono: body.icono || '⚔️',
            color: body.color || '#6366f1',
            participantes: body.participantes || 'todas',
            reglas: typeof body.reglas === 'object' ? body.reglas : {}
        };
        if (!data.nombre) return res.status(400).send('Falta nombre');
        s.db.crearDinamica(data);
        res.send('OK');
    });

    app.all('/api/dinamicas/editar', requireSession, (req, res) => {
        const s = req.userSession;
        const body = req.body || {};
        const id = parseInt(req.query.id || body.id);
        const data = {
            nombre: body.nombre,
            descripcion: body.descripcion || '',
            icono: body.icono || '⚔️',
            color: body.color || '#6366f1',
            participantes: body.participantes || 'todas',
            reglas: typeof body.reglas === 'object' ? body.reglas : {}
        };
        if (!id || !data.nombre) return res.status(400).send('Datos incompletos');
        s.db.editarDinamica(id, data);
        res.send('OK');
    });

    app.all('/api/dinamicas/eliminar', requireSession, (req, res) => {
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (!id) return res.status(400).send('Falta id');
        req.userSession.db.eliminarDinamica(id);
        res.send('OK');
    });

    app.all('/api/dinamicas/duplicar', requireSession, (req, res) => {
        const id = parseInt(req.query.id || (req.body && req.body.id));
        if (!id) return res.status(400).send('Falta id');
        req.userSession.db.duplicarDinamica(id);
        res.send('OK');
    });

    // Runtime Dinámicas
    app.all('/dinamica/start/:id', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const config = s.db.getDinamica(parseInt(req.params.id));
        if (!config) return res.status(404).send('Dinámica no encontrada');
        const participantes = resolverParticipantesDinamica(s, config.participantes);
        if (participantes.length < 2) return res.status(400).send('Se necesitan al menos 2 participantes activos');
        const reglas = config.reglas || {};
        clearInterval(s.timerDinamica);
        s.dinamicaActiva = { ...config, participantes };
        s.tiempoDinamica = (parseInt(reglas.duracion) || 3) * 60;
        s.puntosDinamica = {};
        s.rachasDinamica = {};
        s.amarillasDinamica = {};
        s.eliminadosDinamica = [];
        participantes.forEach(p => { s.puntosDinamica[p] = 0; s.rachasDinamica[p] = 0; s.amarillasDinamica[p] = 0; });
        const payload = { config: s.dinamicaActiva, participantes, puntos: s.puntosDinamica, tiempo: s.tiempoDinamica };
        io.to(user).emit('dinamicaInicio', payload);
        
        s.timerDinamica = setInterval(() => {
            if (s.tiempoDinamica > 0) {
                s.tiempoDinamica--;
                io.to(user).emit('dinamicaTick', s.tiempoDinamica);
            } else {
                clearInterval(s.timerDinamica);
                finalizarDinamica(user);
            }
        }, 1000);
        res.send('OK');
    });

    app.all('/dinamica/stop', requireSession, (req, res) => {
        const s = req.userSession;
        clearInterval(s.timerDinamica);
        s.dinamicaActiva = null;
        io.to(req.username).emit('dinamicaCancelada');
        res.send('OK');
    });

    app.all('/dinamica/eliminar', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const q = req.query.q || (req.body && req.body.q);
        if (!q || !s.dinamicaActiva) return res.status(400).send('Sin dinámica activa o falta nombre');
        if (!s.eliminadosDinamica.includes(q)) s.eliminadosDinamica.push(q);
        io.to(user).emit('dinamicaPuntos', { puntos: s.puntosDinamica, eliminados: s.eliminadosDinamica });
        const activos = s.dinamicaActiva.participantes.filter(p => !s.eliminadosDinamica.includes(p));
        if (activos.length <= 1) { clearInterval(s.timerDinamica); finalizarDinamica(user); }
        res.send('OK');
    });

    return { resolverParticipantesDinamica, finalizarDinamica };
}

module.exports = setupCustomDynamics;
