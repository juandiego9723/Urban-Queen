function createPointsProcessor(io, activeSessions, resolverNombreFn, timerHandlers, conociendoHandlers, revivirHandlers) {

    function procesarRegaloTikTok(username, data) {
        const session = activeSessions[username];
        if (!session) return;
        
        if (!session.batchInterval) {
            session.batchInterval = setInterval(() => {
                procesarPuntosEnLote(username);
            }, 300);
        }
        
        const viewer = (data.uniqueId || '').trim();
        const avatar = data.profilePictureUrl || '';
        const giftName = (data.giftName || '').trim();
        const repeat = parseInt(data.repeatCount) || 1;
        const giftImgSrc = data.giftPictureUrl || '';
        
        // De acuerdo a la especificación oficial de tiktok-live-connector:
        // Los regalos de ráfaga (giftType === 1) envían eventos intermedios con repeatEnd: false.
        // Solo cuando se completa la ráfaga (repeatEnd: true o giftType !== 1) se acredita el valor final en puntos (diamondCount * repeatCount).
        const isStreakInProgress = (data.giftType === 1 && !data.repeatEnd);
        const coins = (data.diamondCount || 1) * repeat;
        
        let rawMapa = session.db.getConfigVal('tiktok_regalo_mapa');
        let mapa = rawMapa ? JSON.parse(rawMapa) : {};
        
        let rawTimerMapa = session.db.getConfigVal('tiktok_timer_mapa');
        let timerMapa = rawTimerMapa ? JSON.parse(rawTimerMapa) : {};
        
        let queenActivadora = mapa[giftName] || null;
        let queenSalto = timerMapa[giftName] || null;
        
        // Prioridad 1: Destinatario directo por uniqueId
        if (data.toUser && data.toUser.uniqueId) {
            const dest = resolverNombreFn(session, data.toUser.uniqueId);
            if (dest) {
                queenActivadora = dest;
            }
        }
        
        // Si no tiene un destinatario explícito por uniqueId, y NO hay batalla en curso ni Dinámica Personalizada activa, aplicar redirecciones automáticas por dinámicas individuales:
        const hayBatallaActiva = session.estadoBatalla !== 'inactiva';
        const hayDinamicaPersonalizadaActiva = !!session.dinamicaActiva;
        if (!queenActivadora && !hayBatallaActiva && !hayDinamicaPersonalizadaActiva) {
            // SI EL TIMER DE BAILE ESTÁ ACTIVO: Forzar que cualquier regalo vaya a la bailarina actual
            if (session.timerBaile.activo && session.timerBaile.estado === 'bailando' && session.timerBaile.chicaActual) {
                queenActivadora = session.timerBaile.chicaActual;
            }
            // SI LA DINÁMICA CONOCIENDO ESTÁ ACTIVA: Forzar que cualquier regalo vaya a la bailarina actual
            else if (session.conociendo.activo && session.conociendo.estado === 'activo' && session.conociendo.chicaActual) {
                queenActivadora = session.conociendo.chicaActual;
            }
            // SI LA DINÁMICA REVIVIR ESTÁ ACTIVA: Forzar que cualquier regalo vaya a la bailarina actual
            else if (session.revivir.activo && session.revivir.estado === 'activo' && session.revivir.chicaActual) {
                queenActivadora = session.revivir.chicaActual;
            }
        }
        
        try {
            let destinatarioFinal = 'Global';
            const esChicaValida = queenActivadora && (
                session.QUEENS.includes(queenActivadora) ||
                (session.timerBaile && session.timerBaile.activo && queenActivadora === session.timerBaile.chicaActual)
            );
            if (esChicaValida) {
                const eq = session.equipos[queenActivadora] || {};
                const pts = eq.regalo_pts ? (eq.regalo_pts * repeat) : coins;
                destinatarioFinal = queenActivadora;
                
                if (!isStreakInProgress) {
                    session.queueUpdate.push({ nombre: queenActivadora, puntos: pts, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: eq.regalo_img || giftImgSrc, repeat });
                    session.db.registrarRegalo(queenActivadora, giftName, pts, viewer);
                    session.lealtadUsuarios[viewer] = queenActivadora;
                }
                
                io.to(username).emit('nuevoRegalo', {
                    nombre: queenActivadora,
                    viewer,
                    avatar,
                    giftImg: eq.regalo_img || giftImgSrc,
                    queenColor: eq.color || '#fff',
                    coins: pts,
                    giftName
                });
            } else {
                const queenAsignada = session.lealtadUsuarios[viewer] || null;
                if (queenAsignada && session.QUEENS.includes(queenAsignada)) {
                    destinatarioFinal = queenAsignada;
                    const eq = session.equipos[queenAsignada] || {};
                    if (!isStreakInProgress) {
                        session.queueUpdate.push({ nombre: queenAsignada, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: eq.regalo_img || giftImgSrc, repeat });
                        session.db.registrarRegalo(queenAsignada, giftName, coins, viewer);
                    }
                    
                    io.to(username).emit('nuevoRegalo', {
                        nombre: queenAsignada,
                        viewer,
                        avatar,
                        giftImg: eq.regalo_img || giftImgSrc,
                        queenColor: eq.color || '#fff',
                        coins,
                        giftName
                    });
                } else if (queenSalto && session.QUEENS.includes(queenSalto)) {
                    destinatarioFinal = queenSalto;
                    const eq = session.equipos[queenSalto] || {};
                    if (!isStreakInProgress) {
                        session.queueUpdate.push({ nombre: queenSalto, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: eq.regalo_img || giftImgSrc, repeat });
                        session.db.registrarRegalo(queenSalto, giftName, coins, viewer);
                    }
                    
                    io.to(username).emit('nuevoRegalo', {
                        nombre: queenSalto,
                        viewer,
                        avatar,
                        giftImg: eq.regalo_img || giftImgSrc,
                        queenColor: eq.color || '#fff',
                        coins,
                        giftName
                    });
                } else {
                    if (!isStreakInProgress) {
                        session.queueUpdate.push({ nombre: null, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: giftImgSrc, repeat });
                        
                        const giftId = `gift-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                        const giftInstance = {
                            id: giftId,
                            giftName,
                            viewer,
                            coins,
                            giftImgSrc,
                            timestamp: new Date().toISOString()
                        };
                        session.regalosDetectados[giftId] = giftInstance;
                        io.to(username).emit('regaloDetectado', giftInstance);
                    }
                }
            }

            io.to(username).emit('tiktokLiveEvent', {
                tipo: 'gift',
                usuario: viewer,
                avatar,
                giftName,
                coins,
                destinatario: destinatarioFinal,
                giftImg: giftImgSrc
            });
        } catch(e) {
            console.error('Error procesando regalo de TikTok:', e);
        }
    }

    function procesarPuntosEnLote(username) {
        const session = activeSessions[username];
        if (!session || session.queueUpdate.length === 0) return;
        
        const temp = [...session.queueUpdate];
        session.queueUpdate = [];
        
        const sumas = {};
        let pointsBatallaDelta = {};
        let pointsDinamicaDelta = {};
        let saltaTurnoPara = null;
        
        temp.forEach(item => {
            if (item.nombre) {
                sumas[item.nombre] = (sumas[item.nombre] || 0) + item.puntos;
                if (session.estadoBatalla === 'activa' && session.participantesActuales.includes(item.nombre)) {
                    pointsBatallaDelta[item.nombre] = (pointsBatallaDelta[item.nombre] || 0) + item.puntos;
                }
                if (session.dinamicaActiva && session.dinamicaActiva.participantes.includes(item.nombre) && !session.eliminadosDinamica.includes(item.nombre)) {
                    pointsDinamicaDelta[item.nombre] = (pointsDinamicaDelta[item.nombre] || 0) + item.puntos;
                }
            }
            if (item.saltaTurno) {
                saltaTurnoPara = item.saltaTurno;
            }
        });
        
        for (const queen in sumas) {
            session.db.sumarPuntos(queen, sumas[queen]);
        }
        
        io.to(username).emit('rankingActualizado');
        io.to(username).emit('actualizarCopa', session.db.getCopa());
        
        if (session.estadoBatalla === 'activa') {
            let actualizados = false;
            for (const queen in pointsBatallaDelta) {
                session.puntosBatalla[queen] = (session.puntosBatalla[queen] || 0) + pointsBatallaDelta[queen];
                actualizados = true;
            }
            if (actualizados) {
                io.to(username).emit('batallaPuntos', session.puntosBatalla);
            }
        }
        
        if (session.dinamicaActiva) {
            let actualizados = false;
            for (const queen in pointsDinamicaDelta) {
                session.puntosDinamica[queen] = (session.puntosDinamica[queen] || 0) + pointsDinamicaDelta[queen];
                actualizados = true;
            }
            if (actualizados) {
                io.to(username).emit('dinamicaPuntos', { puntos: session.puntosDinamica, eliminados: session.eliminadosDinamica });
            }
        }
        
        // Si el timer de baile está activo y en estado de baile, sumar segundos configurados por cada punto recibido por la chica actual
        // Si el timer de baile está activo y en estado de baile
        if (session.timerBaile.activo && session.timerBaile.estado === 'bailando') {
            const chicaActual = session.timerBaile.chicaActual;
            
            // Si NO es modo torneo, acumular tiempo según los segundos por moneda/punto
            if (!session.timerBaile.modoTorneo) {
                const segs = session.timerBaile.segundosPorMoneda || 3;
                temp.forEach(item => {
                    if (item.nombre === chicaActual && item.puntos > 0) {
                        session.timerBaile.tiempo += (item.puntos * segs);
                    }
                });
                io.to(username).emit('timerTick', session.timerBaile.tiempo);
            }
            
            // Si es modo torneo, procesar puntos de la ronda
            if (session.timerBaile.modoTorneo) {
                let nuevosPuntos = 0;
                
                if (!session.timerBaile.puntosTorneo) session.timerBaile.puntosTorneo = {};
                if (!session.timerBaile.donantesTorneo) session.timerBaile.donantesTorneo = {};
                if (!session.timerBaile.donantesAvatarsTorneo) session.timerBaile.donantesAvatarsTorneo = {};
                if (!session.timerBaile.regalosEnviadosTorneo) session.timerBaile.regalosEnviadosTorneo = {};
                if (!session.timerBaile.regalosImgsTorneo) session.timerBaile.regalosImgsTorneo = {};

                temp.forEach(item => {
                    if (item.puntos > 0) {
                        nuevosPuntos += item.puntos;
                        
                        if (item.viewer) {
                            session.timerBaile.donantesTorneo[item.viewer] = (session.timerBaile.donantesTorneo[item.viewer] || 0) + item.puntos;
                            if (item.avatar) {
                                session.timerBaile.donantesAvatarsTorneo[item.viewer] = item.avatar;
                            }
                        }
                        if (item.giftName) {
                            const rep = item.repeat || 1;
                            session.timerBaile.regalosEnviadosTorneo[item.giftName] = (session.timerBaile.regalosEnviadosTorneo[item.giftName] || 0) + rep;
                            if (item.giftImg) {
                                session.timerBaile.regalosImgsTorneo[item.giftName] = item.giftImg;
                            }
                        }
                    }
                });
                
                if (nuevosPuntos > 0) {
                    session.timerBaile.puntosTorneo[chicaActual] = (session.timerBaile.puntosTorneo[chicaActual] || 0) + nuevosPuntos;
                    session.timerBaile.puntosTurnoActual = (session.timerBaile.puntosTurnoActual || 0) + nuevosPuntos;
                    
                    const topDonantes = Object.entries(session.timerBaile.donantesTorneo)
                        .map(([name, pts]) => ({ 
                            name, 
                            pts, 
                            avatar: session.timerBaile.donantesAvatarsTorneo[name] || '' 
                        }))
                        .sort((a, b) => b.pts - a.pts);
                    
                    let mvpName = '';
                    let mvpAvatar = '';
                    if (topDonantes.length > 0) {
                        mvpName = topDonantes[0].name;
                        mvpAvatar = topDonantes[0].avatar;
                    }
                    
                    // Emitir al overlay revivir.html (que visualiza el torneo)
                    io.to(username).emit('revivirPuntos', { 
                        puntos: session.timerBaile.puntosTurnoActual, 
                        meta: session.timerBaile.metaTurno || 1000,
                        topDonantes: topDonantes.slice(0, 3),
                        mvpName,
                        mvpAvatar,
                        regalosEnviados: session.timerBaile.regalosEnviadosTorneo,
                        regalosImgs: session.timerBaile.regalosImgsTorneo
                    });

                    // Emitir al Panel de Control para el marcador en vivo
                    io.to(username).emit('torneoPuntosActualizados', {
                        puntosTorneo: session.timerBaile.puntosTorneo,
                        puntosTurnoActual: session.timerBaile.puntosTurnoActual,
                        chicaActual
                    });
                }
            }
        }

        // Si la dinámica conociendo está activa y en estado activo, sumar los puntos recibidos
        if (session.conociendo.activo && session.conociendo.estado === 'activo') {
            const chicaActual = session.conociendo.chicaActual;
            let nuevosPuntos = 0;
            temp.forEach(item => {
                if (item.nombre === chicaActual && item.puntos > 0) {
                    nuevosPuntos += item.puntos;
                }
            });
            if (nuevosPuntos > 0) {
                session.conociendo.puntos += nuevosPuntos;
                io.to(username).emit('conociendoPuntos', { puntos: session.conociendo.puntos, meta: session.conociendo.meta });
            }
        }

        // Si la dinámica revivir está activa y en estado activo, sumar los puntos recibidos, calcular el MVP y contar los regalos
        if (session.revivir.activo && session.revivir.estado === 'activo') {
            const chicaActual = session.revivir.chicaActual;
            let nuevosPuntos = 0;
            temp.forEach(item => {
                if (item.nombre === chicaActual && item.puntos > 0) {
                    nuevosPuntos += item.puntos;
                    if (item.viewer) {
                        session.revivir.donantes[item.viewer] = (session.revivir.donantes[item.viewer] || 0) + item.puntos;
                        if (item.avatar) {
                            session.revivir.donantesAvatars[item.viewer] = item.avatar;
                        }
                    }
                    if (item.giftName) {
                        const rep = item.repeat || 1;
                        session.revivir.regalosEnviados[item.giftName] = (session.revivir.regalosEnviados[item.giftName] || 0) + rep;
                        if (item.giftImg) {
                            session.revivir.regalosImgs[item.giftName] = item.giftImg;
                        }
                    }
                }
            });
            if (nuevosPuntos > 0) {
                session.revivir.puntos += nuevosPuntos;

                // Si estamos en modo torneo, sumar los puntos de salvación directamente al marcador del torneo
                if (session.timerBaile.modoTorneo) {
                    session.timerBaile.puntosTorneo[chicaActual] = (session.timerBaile.puntosTorneo[chicaActual] || 0) + nuevosPuntos;
                    
                    // Emitir la actualización del marcador del torneo en vivo
                    io.to(username).emit('torneoPuntosActualizados', {
                        puntosTorneo: session.timerBaile.puntosTorneo,
                        chicaActual: session.timerBaile.chicaActual
                    });
                }
                
                const topDonantes = Object.entries(session.revivir.donantes)
                    .map(([name, pts]) => ({ 
                        name, 
                        pts, 
                        avatar: session.revivir.donantesAvatars[name] || '' 
                    }))
                    .sort((a, b) => b.pts - a.pts);
                
                let mvpName = '';
                let mvpAvatar = '';
                if (topDonantes.length > 0) {
                    mvpName = topDonantes[0].name;
                    mvpAvatar = topDonantes[0].avatar;
                }
                
                io.to(username).emit('revivirPuntos', { 
                    puntos: session.revivir.puntos, 
                    meta: session.revivir.meta,
                    topDonantes: topDonantes.slice(0, 3),
                    mvpName,
                    mvpAvatar,
                    regalosEnviados: session.revivir.regalosEnviados,
                    regalosImgs: session.revivir.regalosImgs
                });

                // Si ha alcanzado o superado la meta de salvación, detenerla con éxito inmediatamente
                if (session.revivir.puntos >= session.revivir.meta) {
                    if (revivirHandlers && revivirHandlers.detenerRevivir) {
                        revivirHandlers.detenerRevivir(username, true);
                    }
                }
            }
        }

        if (saltaTurnoPara) {
            if (session.timerBaile.activo && timerHandlers && timerHandlers.saltarSiguienteChica) {
                timerHandlers.saltarSiguienteChica(username, saltaTurnoPara);
            }
            if (session.conociendo.activo && conociendoHandlers && conociendoHandlers.saltarConociendo) {
                conociendoHandlers.saltarConociendo(username, saltaTurnoPara);
            }
        }
    }

    return { procesarRegaloTikTok, procesarPuntosEnLote };
}

module.exports = createPointsProcessor;
