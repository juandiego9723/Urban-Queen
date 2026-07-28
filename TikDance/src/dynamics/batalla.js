function setupBatallaDynamics(app, io, requireSession) {
    app.all('/batalla/start', requireSession, (req, res) => {
        const s = req.userSession;
        const user = req.username;
        s.tiempoBatalla = (parseInt(req.query.m) || 3) * 60;
        s.participantesActuales = req.query.p ? req.query.p.split(',') : [...s.QUEENS];
        s.puntosBatalla = {};
        s.participantesActuales.forEach(p => s.puntosBatalla[p] = 0);
        s.estadoBatalla = 'activa';
        clearInterval(s.timerBatalla);
        let subTickBatalla = 0;
        let tiempoExtraSnipe = 5;
        const victorias = s.db.getVictorias();
        
        io.to(user).emit('batallaInicio', { tiempo: s.tiempoBatalla, puntos: s.puntosBatalla, victorias, equipos: s.equipos, participantes: s.participantesActuales });
        
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
        }, 1000);
        res.send("OK");
    });

    app.all('/batalla/stop', requireSession, (req, res) => {
        const s = req.userSession;
        clearInterval(s.timerBatalla);
        s.estadoBatalla = 'inactiva';
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
