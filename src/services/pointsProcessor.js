function createPointsProcessor(io, activeSessions, resolverNombreFn, timerHandlers, conociendoHandlers, revivirHandlers) {

    function buscarEnMapa(mapaObj, nombreRegalo) {
        if (!mapaObj || !nombreRegalo) return null;
        if (mapaObj[nombreRegalo]) return mapaObj[nombreRegalo];
        
        const target = nombreRegalo.trim().toLowerCase();
        
        // 1. Coincidencia exacta sin distinguir mayúsculas/minúsculas o espacios
        for (const key of Object.keys(mapaObj)) {
            if (key.trim().toLowerCase() === target) {
                return mapaObj[key];
            }
        }
        
        // 2. Mapeo de traducciones y equivalencias de nombres comunes (Español <-> Inglés)
        const ALIAS_TRADUCCION = {
            'rosa': 'rose',
            'rose': 'rosa',
            'white rose': 'rosa blanca',
            'rosa blanca': 'white rose',
            'corazón': 'heart',
            'corazon': 'heart',
            'heart': 'corazon',
            'gafas': 'sunglasses',
            'gafas verdes': 'sunglasses',
            'sunglasses': 'gafas verdes',
            'gorra': 'cap',
            'cap': 'gorra',
            'corona': 'crown',
            'crown': 'corona',
            'helado': 'ice cream cone',
            'ice cream cone': 'helado'
        };
        
        const aliasTarget = ALIAS_TRADUCCION[target];
        if (aliasTarget) {
            for (const key of Object.keys(mapaObj)) {
                if (key.trim().toLowerCase() === aliasTarget) {
                    return mapaObj[key];
                }
            }
        }
        
        return null;
    }

    function procesarRegaloTikTok(username, data) {
        const session = activeSessions[username];
        if (!session) return;
        
        if (!session.batchInterval) {
            session.batchInterval = setInterval(() => {
                procesarPuntosEnLote(username);
            }, 300);
        }
        
        const viewer = (
            data.uniqueId ||
            data.user?.uniqueId ||
            data.user?.displayId ||
            data.senderDetails?.uniqueId ||
            data.userDetails?.uniqueId ||
            (data.user && data.user.unique_id) ||
            ''
        ).trim();

        function resolverStringUrl(val) {
            if (typeof val === 'string' && val.length > 5 && (val.startsWith('http://') || val.startsWith('https://'))) {
                return val;
            }
            if (Array.isArray(val) && val.length > 0) {
                return resolverStringUrl(val.find(x => typeof x === 'string' && x.includes('100x100')) || val[0]);
            }
            if (val && typeof val === 'object') {
                const list = val.urlList || val.url_list || val.urls || val.url;
                if (list) return resolverStringUrl(list);
            }
            return '';
        }

        const avatar = (
            resolverStringUrl(data.profilePictureUrl) ||
            resolverStringUrl(data.user?.profilePictureUrl) ||
            resolverStringUrl(data.userDetails?.profilePictureUrl || data.userDetails?.profilePictureUrls) ||
            resolverStringUrl(data.senderDetails?.profilePictureUrl) ||
            resolverStringUrl(data.avatar) ||
            resolverStringUrl(data.user?.avatarLarge) ||
            resolverStringUrl(data.user?.avatarMedium) ||
            resolverStringUrl(data.user?.avatarThumb) ||
            ''
        );
        const giftName = (
            data.giftName || 
            data.name || 
            (data.gift && (data.gift.gift_name || data.gift.name)) || 
            (data.extendedGiftInfo && data.extendedGiftInfo.name) || 
            (data.giftDetails && data.giftDetails.giftName) || 
            ''
        ).trim();
        const repeat = parseInt(data.repeatCount) || 1;
        const giftImgSrc = data.giftPictureUrl || '';
        const now = Date.now();

        // 1. Desduplicación por msgId / giftId / evento único de TikTok
        if (!session.processedGiftIds) session.processedGiftIds = new Map();
        for (const [id, ts] of session.processedGiftIds.entries()) {
            if (now - ts > 30000) session.processedGiftIds.delete(id);
        }
        const msgId = data.msgId || data.giftId;
        if (msgId) {
            const uniqueEventKey = `${msgId}_${repeat}`;
            if (session.processedGiftIds.has(uniqueEventKey)) {
                return; // Evento duplicado ignorado
            }
            session.processedGiftIds.set(uniqueEventKey, now);
        }

        // 2. Control de Ráfagas (Algoritmo de Delta Incremental)
        if (!session.giftStreaks) session.giftStreaks = {};
        const streakKey = `${viewer}_${giftName}`;
        const previousStreak = session.giftStreaks[streakKey];

        let deltaRepeat = repeat;
        if (previousStreak && (now - previousStreak.lastTime < 6000)) {
            if (repeat > previousStreak.count) {
                deltaRepeat = repeat - previousStreak.count;
            } else {
                deltaRepeat = 0;
            }
        }

        if (data.repeatEnd) {
            delete session.giftStreaks[streakKey];
        } else {
            session.giftStreaks[streakKey] = { count: repeat, lastTime: now };
        }

        if (deltaRepeat <= 0) return;

        const MAPA_REGALOS_RESPALDO = {
            'rose': '/regalos/Rosa.png',
            'tiktok': '/regalos/tiktok.png',
            'gg': '/regalos/GG.png',
            'heart': '/regalos/corazon.png',
            'finger heart': '/regalos/Hand Hearts.png',
            'sunglasses': '/regalos/gafas verdes.png',
            'hand heart': '/regalos/Hand Hearts.png',
            'cap': '/regalos/gorra.png',
            'crown': '/regalos/corona.png',
            'galaxy': '/regalos/Galaxy.png',
            'tiktok universe': '/regalos/TikTok Universe.png',
            'diamond gun': '/regalos/Diamond Gun.png',
            'corgi': '/regalos/Corgi.png',
            'doughnut': '/regalos/dona.png'
        };

        function resolverImagenRegalo(rawSrc, gName, eqImg) {
            let img = (rawSrc || '').trim();
            if (!img && gName) {
                const lowerName = gName.trim().toLowerCase();
                if (session.catalogoRegalos && session.catalogoRegalos.length > 0) {
                    const match = session.catalogoRegalos.find(r => r.name && r.name.toLowerCase() === lowerName);
                    if (match && match.imageUrl) img = match.imageUrl;
                }
                if (!img && MAPA_REGALOS_RESPALDO[lowerName]) {
                    img = MAPA_REGALOS_RESPALDO[lowerName];
                }
            }
            if (!img && eqImg) {
                img = eqImg;
            }
            if (img && !img.startsWith('/') && !img.startsWith('http')) {
                img = '/regalos/' + img;
            }
            return img;
        }

        const diamondUnit = parseInt(data.diamondCount || data.coins) || 1;
        const coins = diamondUnit * deltaRepeat;
        
        let rawMapa = session.db.getConfigVal('tiktok_regalo_mapa');
        let mapa = rawMapa ? JSON.parse(rawMapa) : {};
        
        let rawTimerMapa = session.db.getConfigVal('tiktok_timer_mapa');
        let timerMapa = rawTimerMapa ? JSON.parse(rawTimerMapa) : {};
        
        let queenActivadora = buscarEnMapa(mapa, giftName);
        let queenSalto = buscarEnMapa(timerMapa, giftName);
        
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
            const queenActivadoraClean = (queenActivadora || '').trim();
            const chicaActualClean = (session.timerBaile && session.timerBaile.chicaActual || '').trim();
            
            const esChicaValida = queenActivadoraClean && (
                session.QUEENS.some(q => q.trim().toLowerCase() === queenActivadoraClean.toLowerCase()) ||
                (session.timerBaile && session.timerBaile.activo && queenActivadoraClean.toLowerCase() === chicaActualClean.toLowerCase()) ||
                (session.db && session.db.getAllQueensFull().some(q => q.name.trim().toLowerCase() === queenActivadoraClean.toLowerCase()))
            );
            if (esChicaValida) {
                const eq = session.equipos[queenActivadora] || session.equipos[queenActivadoraClean] || {};
                const customPts = parseInt(eq.regalo_pts);
                const pts = (!isNaN(customPts) && customPts > 0) ? (customPts * deltaRepeat) : coins;
                destinatarioFinal = queenActivadora;
                const giftImgFinal = resolverImagenRegalo(giftImgSrc, giftName, eq.regalo_img);
                
                session.queueUpdate.push({ nombre: queenActivadora, puntos: pts, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: giftImgFinal, repeat: deltaRepeat });
                session.db.registrarRegalo(queenActivadora, giftName, pts, viewer);
                session.lealtadUsuarios[viewer] = queenActivadora;
                
                io.to(username).emit('nuevoRegalo', {
                    nombre: queenActivadora,
                    viewer,
                    avatar,
                    giftImg: giftImgFinal,
                    queenColor: eq.color || '#fff',
                    coins: pts,
                    giftName
                });
            } else {
                const queenAsignada = session.lealtadUsuarios[viewer] || null;
                if (queenAsignada && session.QUEENS.includes(queenAsignada)) {
                    destinatarioFinal = queenAsignada;
                    const eq = session.equipos[queenAsignada] || {};
                    const giftImgFinal = resolverImagenRegalo(giftImgSrc, giftName, eq.regalo_img);
                    
                    session.queueUpdate.push({ nombre: queenAsignada, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: giftImgFinal, repeat: deltaRepeat });
                    session.db.registrarRegalo(queenAsignada, giftName, coins, viewer);
                    
                    io.to(username).emit('nuevoRegalo', {
                        nombre: queenAsignada,
                        viewer,
                        avatar,
                        giftImg: giftImgFinal,
                        queenColor: eq.color || '#fff',
                        coins,
                        giftName
                    });
                } else if (queenSalto && session.QUEENS.includes(queenSalto)) {
                    destinatarioFinal = queenSalto;
                    const eq = session.equipos[queenSalto] || {};
                    const giftImgFinal = resolverImagenRegalo(giftImgSrc, giftName, eq.regalo_img);
                    
                    session.queueUpdate.push({ nombre: queenSalto, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: giftImgFinal, repeat: deltaRepeat });
                    session.db.registrarRegalo(queenSalto, giftName, coins, viewer);
                    
                    io.to(username).emit('nuevoRegalo', {
                        nombre: queenSalto,
                        viewer,
                        avatar,
                        giftImg: giftImgFinal,
                        queenColor: eq.color || '#fff',
                        coins,
                        giftName
                    });
                } else {
                    const giftImgFinal = resolverImagenRegalo(giftImgSrc, giftName, '');
                    session.queueUpdate.push({ nombre: null, puntos: coins, saltaTurno: queenSalto, viewer, avatar, giftName, giftImg: giftImgFinal, repeat: deltaRepeat });
                    
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
                const chicaNorm = (chicaActual || '').trim().toLowerCase();
                temp.forEach(item => {
                    const itemNorm = (item.nombre || '').trim().toLowerCase();
                    if (itemNorm && itemNorm === chicaNorm && item.puntos > 0) {
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

                // Si estamos en modo torneo, sumar los puntos de salvación directamente al marcador del torneo (si el timer de baile no los sumó ya)
                if (session.timerBaile.modoTorneo && (!session.timerBaile.activo || session.timerBaile.estado !== 'bailando')) {
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
