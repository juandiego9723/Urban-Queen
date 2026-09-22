let WebcastPushConnection;
let RouteConfig;
let RoomIdRouteConfig;
let IsLiveRouteConfig;

try {
    const tlcMain = require('tiktok-live-connector');
    RouteConfig = tlcMain.RouteConfig;
    RoomIdRouteConfig = tlcMain.RoomIdRouteConfig;
    IsLiveRouteConfig = tlcMain.IsLiveRouteConfig;
} catch (e) {}

try {
    const tlcLegacy = require('tiktok-live-connector/legacy');
    WebcastPushConnection = tlcLegacy.WebcastPushConnection || tlcLegacy.TikTokLiveConnection || tlcLegacy;
    if (!RouteConfig) RouteConfig = tlcLegacy.RouteConfig;
    if (!RoomIdRouteConfig) RoomIdRouteConfig = tlcLegacy.RoomIdRouteConfig;
    if (!IsLiveRouteConfig) IsLiveRouteConfig = tlcLegacy.IsLiveRouteConfig;
} catch (e) {
    const tlc = require('tiktok-live-connector');
    WebcastPushConnection = tlc.WebcastPushConnection || tlc.TikTokLiveConnection || tlc;
    if (!RouteConfig) RouteConfig = tlc.RouteConfig;
    if (!RoomIdRouteConfig) RoomIdRouteConfig = tlc.RoomIdRouteConfig;
    if (!IsLiveRouteConfig) IsLiveRouteConfig = tlc.IsLiveRouteConfig;
}

// Desactivar rutas secundarias de EulerStream que requieren Plan Business
if (RoomIdRouteConfig) RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
if (IsLiveRouteConfig) IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;

// Respaldo de firmas: Si EulerStream rechaza por requerir Plan Business o por Rate Limit, continuar con conexión directa
if (RouteConfig && RouteConfig.fetchWebcastSignatureFromProvider) {
    const originalFetchSignature = RouteConfig.fetchWebcastSignatureFromProvider;
    RouteConfig.fetchWebcastSignatureFromProvider = async (args) => {
        try {
            return await originalFetchSignature(args);
        } catch (err) {
            const errStr = (err && err.message) ? err.message : String(err);
            const requiereFallback = errStr.includes('Business plan') || errStr.includes('pricing') || errStr.includes('429') || errStr.includes('rate_limit') || errStr.includes('quota');
            if (requiereFallback) {
                console.warn('⚠️ [TikTok Connector] Omitiendo firmas de EulerStream (Endpoint requiere Plan Business o Rate Limit). Continuando con conexión directa.');
                return { response: { signedUrl: args.url, userAgent: args.userAgent } };
            }
            throw err;
        }
    };
}

function createTikTokService(app, io, requireSession, activeSessions, procesarRegaloTikTokFn) {

    function conectarTikTok(username, usuarioTikTok, req) {
        const session = activeSessions[username];
        if (!session) return;

        // Si ya está intentando conectar con el mismo usuario en este momento, ignorar para evitar Rate Limits
        if (session.tiktokEstado === 'conectando' && session.tiktokUsuario === usuarioTikTok) {
            console.log(`[TikTok] Conexión en curso para @${usuarioTikTok}. Ignorando petición duplicada.`);
            return;
        }

        if (session.tiktokConnection) {
            try {
                if (typeof session.tiktokConnection.removeAllListeners === 'function') {
                    session.tiktokConnection.removeAllListeners();
                }
                session.tiktokConnection.disconnect();
            } catch (e) {}
            session.tiktokConnection = null;
        }

        session.tiktokEstado = 'conectando';
        session.tiktokUsuario = usuarioTikTok;
        session.tiktokMensajeError = '';
        io.to(username).emit('tiktokEstado', { estado: 'conectando', usuario: usuarioTikTok });

        const referer = (req && req.headers && req.headers.referer) ? req.headers.referer.toLowerCase() : '';
        const reqAgency = (req && (req.agencySlug || (req.agency && req.agency.slug) || (req.session && req.session.agencySlug))) || '';

        let signApiKey = process.env.SIGN_API_KEY;
        const isCosmic = (reqAgency.toLowerCase() === 'cosmic') ||
                         (session.agencySlug === 'cosmic') ||
                         referer.includes('/cosmic') ||
                         referer.includes('agency=cosmic') ||
                         (username && username.toLowerCase().includes('cosmic')) ||
                         (usuarioTikTok && usuarioTikTok.toLowerCase().includes('cosmic'));

        if (isCosmic && process.env.COSMIC_SIGN_API_KEY) {
            signApiKey = process.env.COSMIC_SIGN_API_KEY;
            session.agencySlug = 'cosmic';
            console.log(`🔑 [TikTok Service] Conectando @${usuarioTikTok} usando API Key dedicada para COSMIC (${signApiKey.substring(0, 15)}...)`);
        } else if (signApiKey) {
            console.log(`🔑 [TikTok Service] Conectando @${usuarioTikTok} usando API Key por defecto TIKDANCE (${signApiKey.substring(0, 15)}...)`);
        }

        const connection = new WebcastPushConnection(usuarioTikTok, {
            enableExtendedGiftInfo: true,
            signApiKey: signApiKey,
            requestOptions: {
                timeout: 15000
            },
            clientParams: {
                app_language: 'es-ES',
                webcast_language: 'es-ES'
            }
        });

        session.tiktokConnection = connection;

        connection.connect().then(state => {
            session.tiktokEstado = 'conectado';
            session.tiktokMensajeError = '';
            io.to(username).emit('tiktokEstado', { estado: 'conectado', usuario: usuarioTikTok });

            // Auto-reset de rankings diario, semanal y mensual
            try {
                const now = new Date();
                const diaStr = now.toLocaleDateString('sv');
                const mesStr = diaStr.substring(0, 7);

                function getISOWeekString(date) {
                    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                    const dayNum = d.getUTCDay() || 7;
                    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
                    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
                }
                const semanaStr = getISOWeekString(now);

                const lastDiario = session.db.getConfigVal('last_reset_diario') || '';
                const lastSemanal = session.db.getConfigVal('last_reset_semanal') || '';
                const lastMensual = session.db.getConfigVal('last_reset_mensual') || '';

                let huboCambios = false;

                if (!lastDiario) {
                    session.db.setConfigVal('last_reset_diario', diaStr);
                } else if (lastDiario !== diaStr) {
                    console.log(`[Auto-Reset] Nuevo día detectado: ${diaStr} (Anterior: ${lastDiario}). Reiniciando ranking diario.`);
                    session.db.resetDiario();
                    session.db.setConfigVal('last_reset_diario', diaStr);
                    huboCambios = true;
                }

                if (!lastSemanal) {
                    session.db.setConfigVal('last_reset_semanal', semanaStr);
                } else if (lastSemanal !== semanaStr) {
                    console.log(`[Auto-Reset] Nueva semana detectada: ${semanaStr} (Anterior: ${lastSemanal}). Reiniciando ranking semanal.`);
                    session.db.resetSemanal();
                    session.db.setConfigVal('last_reset_semanal', semanaStr);
                    huboCambios = true;
                }

                if (!lastMensual) {
                    session.db.setConfigVal('last_reset_mensual', mesStr);
                } else if (lastMensual !== mesStr) {
                    console.log(`[Auto-Reset] Nuevo mes detectado: ${mesStr} (Anterior: ${lastMensual}). Reiniciando ranking mensual.`);
                    session.db.resetMensual();
                    session.db.setConfigVal('last_reset_mensual', mesStr);
                    huboCambios = true;
                }

                if (huboCambios) {
                    io.to(username).emit('queensActualizadas', {
                        queens: session.QUEENS,
                        equipos: session.equipos,
                        apodos: session.db.getApodosMap()
                    });
                }
            } catch (resetErr) {
                console.error('Error durante el auto-reset de rankings:', resetErr);
            }

            connection.fetchAvailableGifts().then(gifts => {
                session.catalogoRegalos = (gifts || []).map(g => ({
                    id: g.id || g.giftId,
                    name: g.name,
                    diamondCount: g.diamond_count || g.diamondCount || g.cost || 0,
                    imageUrl: g.image?.url_list?.[0] || g.imageUrl || ''
                }));
                io.to(username).emit('catalogoCargado', session.catalogoRegalos.length);
            }).catch(err => {
                console.error('Error cargando catálogo de regalos de TikTok:', err);
            });
        }).catch(err => {
            const rawErrMsg = (err && err.message) ? err.message : (err ? err.toString() : 'Error desconocido');
            
            // Auto-retry para el bug intermitente de legacy.js (getTopViewerAttributes .map)
            const esErrorLegacy = rawErrMsg.includes("reading 'map'") || rawErrMsg.includes("reading 'includes'");
            if (!session._retryCount) session._retryCount = 0;
            
            if (esErrorLegacy && session._retryCount < 3) {
                session._retryCount++;
                console.log(`🔄 [TikTok] Error intermitente de legacy.js (intento ${session._retryCount}/3). Reintentando en 2s...`);
                session.tiktokConnection = null;
                setTimeout(() => conectarTikTok(username, usuarioTikTok, req), 2000);
                return;
            }
            session._retryCount = 0;
            
            console.error('Error al conectar TikTok:', err);
            session.tiktokEstado = 'error';
            
            let rawErr = rawErrMsg;
            const errDetails = JSON.stringify(err || {});
            
            if (rawErr.includes('user_not_found') || errDetails.includes('19881007') || rawErr.includes('FetchIsLiveError')) {
                rawErr = `El usuario @${usuarioTikTok} no existe o no está transmitiendo EN VIVO en este momento.`;
            } else if (rawErr.includes('Rate Limited') || rawErr.includes('rate_limit')) {
                rawErr = `Se alcanzó el límite anónimo del servidor externo EulerStream. Se ha desactivado EulerStream para usar la conexión directa de TikTok.`;
            } else if (rawErr.includes('Sign Error') || rawErr.includes('500')) {
                rawErr = `Error 500 del servidor de firmas de TikTok. Verifica que la cuenta esté en vivo o reintenta en un momento.`;
            }
            
            session.tiktokMensajeError = rawErr;
            io.to(username).emit('tiktokEstado', { estado: 'error', usuario: usuarioTikTok, error: session.tiktokMensajeError });
            session.tiktokConnection = null;
        });

        function resolverAvatarUsuario(data) {
            if (!data) return '';
            function extraerUrl(val) {
                if (typeof val === 'string' && val.length > 5 && (val.startsWith('http://') || val.startsWith('https://'))) {
                    return val;
                }
                if (Array.isArray(val) && val.length > 0) {
                    return extraerUrl(val.find(x => typeof x === 'string' && x.includes('100x100')) || val[0]);
                }
                if (val && typeof val === 'object') {
                    const list = val.urlList || val.url_list || val.urls || val.url;
                    if (list) return extraerUrl(list);
                }
                return '';
            }

            const c1 = extraerUrl(data.profilePictureUrl);
            if (c1) return c1;

            const c2 = extraerUrl(data.userDetails?.profilePictureUrl || data.userDetails?.profilePictureUrls);
            if (c2) return c2;

            const c3 = extraerUrl(data.senderDetails?.profilePictureUrl);
            if (c3) return c3;

            const u = data.user || data.userDetails || data.senderDetails;
            if (u) {
                const urls = u.avatarLarge?.urlList || u.avatarLarge?.url_list || u.avatarLarge ||
                             u.avatarMedium?.urlList || u.avatarMedium?.url_list || u.avatarMedium ||
                             u.avatarThumb?.urlList || u.avatarThumb?.url_list || u.avatarThumb;
                const c4 = extraerUrl(urls);
                if (c4) return c4;
            }
            return '';
        }

        connection.on('gift', (data) => {
            // Garantizar que data.profilePictureUrl sea SIEMPRE un string URL válido
            data.profilePictureUrl = resolverAvatarUsuario(data);

            // Resolver giftName desde giftId si la librería no lo envía
            if (!data.giftName && data.giftId) {
                const gid = parseInt(data.giftId);
                // 1. Buscar en catálogo dinámico descargado al conectar
                let found = (session.catalogoRegalos || []).find(g => parseInt(g.id) === gid);
                // 2. Mapa de respaldo hardcoded (IDs más comunes)
                if (!found) {
                    const GIFT_ID_MAP = {
                        5655:'Rose', 6948:'TikTok', 7493:'GG', 6551:'Heart', 6104:'Finger Heart',
                        6683:'Like', 7494:'Super GG', 6435:'Mic', 5652:'Sunglasses', 7305:'Hand Heart',
                        6812:'Soccer Ball', 8525:'Cap', 6056:'Lucky Cat', 7394:'Ice Cream Cone',
                        7560:'Cake', 8121:'Crown', 7572:'Yacht', 8744:'Airplane', 8913:'Galaxy',
                        7028:'Concert', 6557:'Lion', 7071:'TikTok Universe', 8604:'Island',
                        6468:'Drama Queen', 7400:'Sports Car', 7399:'Bus', 8614:'Diamond Gun',
                        6648:'Perfume', 7100:'Power Pump', 8215:'Little Ghost', 7781:'Star',
                        8700:'Boxing Gloves', 8701:'Corgi', 9002:'Doughnut', 9003:'Headphones'
                    };
                    if (GIFT_ID_MAP[gid]) {
                        data.giftName = GIFT_ID_MAP[gid];
                    }
                } else {
                    data.giftName = found.name;
                    if (!data.diamondCount && found.diamondCount) data.diamondCount = found.diamondCount;
                    if (!data.giftPictureUrl && found.imageUrl) data.giftPictureUrl = found.imageUrl;
                }
                console.log(`🎁 [Gift Resolved] ID:${data.giftId} → "${data.giftName || '???'}" (${data.diamondCount || '?'}💎)`);
                console.log(`🔍 [USER INFO] uniqueId:${data.uniqueId || 'NONE'} | profilePic:${data.profilePictureUrl ? 'YES' : 'NONE'} (${(data.profilePictureUrl || '').substring(0,60)}...)`);
            }
            if (typeof procesarRegaloTikTokFn === 'function') {
                procesarRegaloTikTokFn(username, data);
            }
        });

        connection.on('chat', (data) => {
            const av = resolverAvatarUsuario(data);
            io.to(username).emit('tiktokLiveEvent', { tipo: 'chat', usuario: data.uniqueId, comentario: data.comment, avatar: av });
        });

        connection.on('like', (data) => {
            const av = resolverAvatarUsuario(data);
            io.to(username).emit('tiktokLiveEvent', { tipo: 'like', usuario: data.uniqueId, cantidad: data.likeCount, avatar: av });
        });

        connection.on('social', (data) => {
            const av = resolverAvatarUsuario(data);
            const subtipo = (data.displayType && data.displayType.includes('follow')) ? 'follow' : 'share';
            io.to(username).emit('tiktokLiveEvent', { tipo: subtipo, usuario: data.uniqueId, descripcion: data.label, avatar: av });
        });

        connection.on('member', (data) => {
            const av = resolverAvatarUsuario(data);
            io.to(username).emit('tiktokLiveEvent', { tipo: 'join', usuario: data.uniqueId, avatar: av });
        });

        connection.on('roomUser', (data) => {
            io.to(username).emit('tiktokLiveEvent', { tipo: 'roomUser', viewerCount: data.viewerCount });
        });

        connection.on('disconnected', () => {
            session.tiktokEstado = 'desconectado';
            session.tiktokUsuario = '';
            io.to(username).emit('tiktokEstado', { estado: 'desconectado', usuario: '' });
            session.tiktokConnection = null;
        });

        connection.on('streamEnd', () => {
            session.tiktokEstado = 'desconectado';
            session.tiktokUsuario = '';
            io.to(username).emit('tiktokEstado', { estado: 'desconectado', usuario: '' });
            session.tiktokConnection = null;
        });
    }

    app.all('/tiktok/conectar', requireSession, (req, res) => {
        const usuario = (req.query.usuario || (req.body && req.body.usuario) || '').replace('@', '').trim();
        if (!usuario) return res.status(400).send('Falta usuario de TikTok');
        conectarTikTok(req.username, usuario, req);
        res.send('Conectando...');
    });

    app.all('/tiktok/desconectar', requireSession, (req, res) => {
        const s = req.userSession;
        if (s.tiktokConnection) {
            try {
                if (typeof s.tiktokConnection.removeAllListeners === 'function') {
                    s.tiktokConnection.removeAllListeners();
                }
                s.tiktokConnection.disconnect();
            } catch (e) {}
            s.tiktokConnection = null;
        }
        s.tiktokEstado = 'desconectado';
        s.tiktokUsuario = '';
        io.to(req.username).emit('tiktokEstado', { estado: s.tiktokEstado, usuario: '' });
        res.send('OK');
    });

    app.get('/tiktok/test-gift', requireSession, (req, res) => {
        const giftName = req.query.gift || req.query.giftName || 'Rose';
        const repeat = parseInt(req.query.repeat || req.query.repeatCount || '1');
        const destName = req.query.to || req.query.toUser || '';
        const viewer = req.query.viewer || req.query.uniqueId || 'TesterUnique';
        const diamonds = parseInt(req.query.diamonds || req.query.coins || req.query.diamondCount || '10');
        const giftPic = req.query.giftPictureUrl || req.query.giftPic || 'https://p19-webcast.tiktokcdn.com/img/webcast/5f8efc0f4f9f6e72c84285fbfe4e2b00.png~tplv-obj.image';
        const fakeData = {
            uniqueId: viewer,
            profilePictureUrl: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/7311145620163350534~tplv-tiktok-shrink:100:100.webp',
            giftName: giftName,
            diamondCount: diamonds,
            repeatCount: repeat,
            giftPictureUrl: giftPic
        };
        if (destName) {
            fakeData.toUser = {
                uniqueId: destName.toLowerCase(),
                nickname: destName + '💙'
            };
        }
        if (typeof procesarRegaloTikTokFn === 'function') {
            procesarRegaloTikTokFn(req.username, fakeData);
        }
        res.send({ status: 'OK', simulatedData: fakeData });
    });

    app.get('/api/tiktok/estado', requireSession, (req, res) => {
        const s = req.userSession;
        res.json({ estado: s.tiktokEstado, usuario: s.tiktokUsuario, error: s.tiktokMensajeError });
    });

    app.get('/api/tiktok/mapa', requireSession, (req, res) => {
        const v = req.userSession.db.getConfigVal('tiktok_regalo_mapa');
        res.json(v ? JSON.parse(v) : {});
    });

    app.post('/api/tiktok/mapa', requireSession, (req, res) => {
        const s = req.userSession;
        const mapa = req.body.mapa || req.body;
        s.db.setConfigVal('tiktok_regalo_mapa', JSON.stringify(mapa));
        io.to(req.username).emit('mapaRegalosCambiado', mapa);
        res.send('OK');
    });

    app.get('/api/tiktok/timer_mapa', requireSession, (req, res) => {
        const v = req.userSession.db.getConfigVal('tiktok_timer_mapa');
        res.json(v ? JSON.parse(v) : {});
    });

    app.post('/api/tiktok/timer_mapa', requireSession, (req, res) => {
        const s = req.userSession;
        const mapa = req.body.mapa || req.body;
        s.db.setConfigVal('tiktok_timer_mapa', JSON.stringify(mapa));
        io.to(req.username).emit('mapaTimerCambiado', mapa);
        res.send('OK');
    });

    const CATALOGO_RESPALDO = [
        { id:5655, name:'Rose',             diamondCount:1,     imageUrl:'/regalos/Rosa.png' },
        { id:6948, name:'TikTok',           diamondCount:1,     imageUrl:'/regalos/tiktok.png' },
        { id:7493, name:'GG',               diamondCount:1,     imageUrl:'/regalos/GG.png' },
        { id:6551, name:'Heart',            diamondCount:1,     imageUrl:'/regalos/corazon.png' },
        { id:6104, name:'Finger Heart',     diamondCount:5,     imageUrl:'/regalos/Hand Hearts.png' },
        { id:6683, name:'Like',             diamondCount:1,     imageUrl:'' },
        { id:7494, name:'Super GG',         diamondCount:99,    imageUrl:'' },
        { id:6435, name:'Mic',              diamondCount:10,    imageUrl:'' },
        { id:5652, name:'Sunglasses',       diamondCount:199,   imageUrl:'/regalos/gafas verdes.png' },
        { id:7305, name:'Hand Heart',       diamondCount:100,   imageUrl:'/regalos/Hand Hearts.png' },
        { id:6812, name:'Soccer Ball',      diamondCount:1,     imageUrl:'' },
        { id:8525, name:'Cap',              diamondCount:99,    imageUrl:'/regalos/gorra.png' },
        { id:6056, name:'Lucky Cat',        diamondCount:199,   imageUrl:'' },
        { id:7394, name:'Ice Cream Cone',   diamondCount:1,     imageUrl:'' },
        { id:7560, name:'Cake',             diamondCount:299,   imageUrl:'' },
        { id:8121, name:'Crown',            diamondCount:99,    imageUrl:'/regalos/corona.png' },
        { id:7572, name:'Yacht',            diamondCount:1000,  imageUrl:'' },
        { id:8744, name:'Airplane',         diamondCount:1000,  imageUrl:'' },
        { id:8913, name:'Galaxy',           diamondCount:1000,  imageUrl:'/regalos/Galaxy.png' },
        { id:7028, name:'Concert',          diamondCount:500,   imageUrl:'' },
        { id:6557, name:'Lion',             diamondCount:29999, imageUrl:'' },
        { id:7071, name:'TikTok Universe',  diamondCount:44999, imageUrl:'/regalos/TikTok Universe.png' },
        { id:8604, name:'Island',           diamondCount:15000, imageUrl:'' },
        { id:6468, name:'Drama Queen',      diamondCount:5000,  imageUrl:'' },
        { id:7400, name:'Sports Car',       diamondCount:7000,  imageUrl:'' },
        { id:7399, name:'Bus',              diamondCount:1000,  imageUrl:'' },
        { id:8614, name:'Diamond Gun',      diamondCount:2999,  imageUrl:'/regalos/Diamond Gun.png' },
        { id:6648, name:'Perfume',          diamondCount:20,    imageUrl:'' },
        { id:7100, name:'Power Pump',       diamondCount:199,   imageUrl:'' },
        { id:8215, name:'Little Ghost',     diamondCount:299,   imageUrl:'' },
        { id:7781, name:'Star',             diamondCount:10,    imageUrl:'' },
        { id:8700, name:'Boxing Gloves',    diamondCount:299,   imageUrl:'' },
        { id:8701, name:'Corgi',            diamondCount:299,   imageUrl:'/regalos/Corgi.png' },
        { id:9002, name:'Doughnut',         diamondCount:30,    imageUrl:'/regalos/dona.png' },
        { id:9003, name:'Headphones',       diamondCount:20,    imageUrl:'' },
    ].sort((a,b) => a.name.localeCompare(b.name));

    app.get('/api/tiktok/catalogo', requireSession, (req, res) => {
        const s = req.userSession;
        const q = (req.query.q || '').toLowerCase();
        
        let fuente = CATALOGO_RESPALDO;
        if (s.catalogoRegalos.length > 0) {
            const mapaDinamico = {};
            s.catalogoRegalos.forEach(r => {
                mapaDinamico[r.name.toLowerCase()] = r;
            });

            fuente = CATALOGO_RESPALDO.map(r => {
                const din = mapaDinamico[r.name.toLowerCase()];
                if (din) {
                    return {
                        id: din.id || r.id,
                        name: din.name || r.name,
                        diamondCount: din.diamondCount || r.diamondCount,
                        imageUrl: din.imageUrl || r.imageUrl
                    };
                }
                return r;
            });

            const nombresRespaldo = new Set(CATALOGO_RESPALDO.map(r => r.name.toLowerCase()));
            const extra = s.catalogoRegalos.filter(r => !nombresRespaldo.has(r.name.toLowerCase()));
            fuente = [...fuente, ...extra].sort((a,b) => a.name.localeCompare(b.name));
        }

        const lista = q
            ? fuente.filter(g => g.name.toLowerCase().includes(q))
            : fuente;
        
        res.json({ regalos: lista, esCatalogoCompleto: s.catalogoRegalos.length > 0 });
    });

    return { conectarTikTok };
}

module.exports = createTikTokService;
