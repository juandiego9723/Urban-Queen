function checkIsCosmic(req, session) {
    if (session && session.agencySlug === 'cosmic') return true;
    if (session && session.db && session.db.agencySlug === 'cosmic') return true;
    if (req && req.agencySlug === 'cosmic') return true;
    if (req && req.agency && req.agency.slug === 'cosmic') return true;
    if (req && req.query && req.query.agency === 'cosmic') return true;
    const referer = (req && req.headers && req.headers.referer) ? req.headers.referer.toLowerCase() : '';
    if (referer.includes('/cosmic') || referer.includes('agency=cosmic')) return true;
    const username = (req && req.username) || (session && session.username) || '';
    if (username.toLowerCase().includes('cosmic')) return true;
    return false;
}

function setupBatallaDynamics(app, io, requireSession) {
    app.all('/batalla/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        const isCosmic = checkIsCosmic(req, s);
        s.tiempoBatalla = (parseInt(req.query.m) || 3) * 60;
        s.participantesActuales = req.query.p ? req.query.p.split(',') : [...s.QUEENS];
        s.puntosBatalla = {};
        s.participantesActuales.forEach(p => s.puntosBatalla[p] = 0);
        s.estadoBatalla = 'activa';
        
        if (isCosmic) {
            // Cosmic: 2X exclusivamente en los últimos 30 segundos
            s.batalla2X = (s.tiempoBatalla <= 30);
            s.batalla2XTiempo = s.batalla2X ? s.tiempoBatalla : 0;
        } else {
            // Urban (original): 2X los primeros 45 segundos
            s.batalla2X = true;
            s.batalla2XTiempo = Math.min(45, s.tiempoBatalla);
        }

        clearInterval(s.timerBatalla);
        let subTickBatalla = 0;
        let tiempoExtraSnipe = 5;
        const victorias = s.db.getVictorias();
        
        io.to(user).emit('batallaInicio', { 
            tiempo: s.tiempoBatalla, 
            puntos: s.puntosBatalla, 
            victorias, 
            equipos: s.equipos, 
            participantes: s.participantesActuales,
            batalla2X: s.batalla2X,
            batalla2XTiempo: s.batalla2XTiempo
        });
        
        s.timerBatalla = setInterval(() => {
            if (s.tiempoBatalla > 3) {
                s.tiempoBatalla--;
                io.to(user).emit('batallaTick', s.tiempoBatalla);
            } else if (s.tiempoBatalla > 0) {
                subTickBatalla++;
                if (subTickBatalla >= 2) {
                    s.tiempoBatalla--;
                    subTickBatalla = 0;
                }
                io.to(user).emit('batallaTick', s.tiempoBatalla);
            } else {
                io.to(user).emit('batallaTick', 0);
                tiempoExtraSnipe--;
                if (tiempoExtraSnipe <= 0) {
                    clearInterval(s.timerBatalla);
                    s.estadoBatalla = 'finalizada';
                    let maxPts = 0;
                    s.participantesActuales.forEach(p => { if (s.puntosBatalla[p] > maxPts) maxPts = s.puntosBatalla[p]; });
                    let ganadoras = s.participantesActuales.filter(c => s.puntosBatalla[c] === maxPts);
                    let ganadora = (ganadoras.length === 1 && maxPts > 0) ? ganadoras[0] : (maxPts === 0 ? 'SIN PUNTOS' : 'EMPATE');
                    
                    if (ganadora !== 'EMPATE' && ganadora !== 'SIN PUNTOS') {
                        s.db.sumarVictoria(ganadora);
                        s.participantesActuales.forEach(p => {
                            if (p !== ganadora) {
                                s.db.sumarDerrota(p);
                            }
                        });
                    } else {
                        s.participantesActuales.forEach(p => {
                            s.db.sumarEmpate(p);
                        });
                    }
                    
                    const victoriasActuales = s.db.getVictorias();
                    let reporteTarjetas = [];
                    s.participantesActuales.forEach(chica => {
                        if (ganadoras.includes(chica) && maxPts > 0) {
                            s.rachasPerdidas[chica] = 0;
                        } else {
                            s.rachasPerdidas[chica]++;
                            if (s.rachasPerdidas[chica] >= s.configFutbol.limiteAmarilla) {
                                s.amarillasAcumuladas[chica]++;
                                if (s.amarillasAcumuladas[chica] >= 2) {
                                    reporteTarjetas.push({ chica, equipo: s.equipos[chica]?.nombre || 'BAILARINA', tipo: 'ROJA' });
                                    s.amarillasAcumuladas[chica] = 0;
                                } else {
                                    reporteTarjetas.push({ chica, equipo: s.equipos[chica]?.nombre || 'BAILARINA', tipo: 'AMARILLA' });
                                }
                                s.rachasPerdidas[chica] = 0;
                            }
                        }
                    });
                    
                    const payloadFin = { ganadora, victorias: victoriasActuales, reporteTarjetas, participantes: s.participantesActuales };
                    io.to(user).emit('batallaFin', payloadFin);
                    setTimeout(() => io.to(user).emit('batallaFin', payloadFin), 300);
                    setTimeout(() => io.to(user).emit('batallaFin', payloadFin), 600);
                }
            }

            // ── Lógica 2X según Agencia ──
            if (isCosmic) {
                // Cosmic: 2X activo exclusivamente en los últimos 30 segundos
                if (s.tiempoBatalla <= 30 && s.tiempoBatalla > 0) {
                    s.batalla2X = true;
                    s.batalla2XTiempo = s.tiempoBatalla;
                    io.to(user).emit('batalla2XTick', { tiempo2X: s.batalla2XTiempo, activo: true });
                } else if (s.batalla2X) {
                    s.batalla2X = false;
                    s.batalla2XTiempo = 0;
                    io.to(user).emit('batalla2XFin');
                    io.to(user).emit('batalla2XTick', { tiempo2X: 0, activo: false });
                }
            } else {
                // Urban (original): 2X los primeros 45 segundos
                if (s.batalla2XTiempo > 0) {
                    s.batalla2XTiempo--;
                    if (s.batalla2XTiempo === 0) {
                        s.batalla2X = false;
                        io.to(user).emit('batalla2XFin');
                    }
                    io.to(user).emit('batalla2XTick', { tiempo2X: s.batalla2XTiempo, activo: s.batalla2X });
                }
            }
        }, 1000);
        res.send("OK");
    });

    app.all('/batalla/stop', requireSession, (req, res) => {
        const s = req.userSession;
        clearInterval(s.timerBatalla);
        s.estadoBatalla = 'inactiva';
        s.batalla2X = false;
        s.batalla2XTiempo = 0;
        io.to(req.username).emit('batallaCancelada');
        setTimeout(() => io.to(req.username).emit('batallaCancelada'), 300);
        setTimeout(() => io.to(req.username).emit('batallaCancelada'), 600);
        res.send("OK");
    });

    app.all('/batalla/reset-wins', requireSession, (req, res) => {
        req.userSession.db.resetVictorias();
        res.send("OK");
    });
}

module.exports = setupBatallaDynamics;
