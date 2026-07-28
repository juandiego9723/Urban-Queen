const { WebcastPushConnection } = require('tiktok-live-connector');

function createTikTokService(app, io, requireSession, activeSessions, procesarRegaloTikTokFn) {

    function conectarTikTok(username, usuarioTikTok) {
        const session = activeSessions[username];
        if (!session) return;

        if (session.tiktokConnection) {
            try { session.tiktokConnection.disconnect(); } catch (e) {}
            session.tiktokConnection = null;
        }

        session.tiktokEstado = 'conectando';
        session.tiktokUsuario = usuarioTikTok;
        session.tiktokMensajeError = '';
        io.to(username).emit('tiktokEstado', { estado: 'conectando', usuario: usuarioTikTok });

        const connection = new WebcastPushConnection(usuarioTikTok, {
            enableExtendedGiftInfo: true
        });

        session.tiktokConnection = connection;

        connection.connect().then(state => {
            session.tiktokEstado = 'conectado';
            session.tiktokMensajeError = '';
            io.to(username).emit('tiktokEstado', { estado: 'conectado', usuario: usuarioTikTok });
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
            console.error('Error al conectar TikTok:', err);
            session.tiktokEstado = 'error';
            session.tiktokMensajeError = err.message || (err.toString ? err.toString() : 'Error desconocido');
            io.to(username).emit('tiktokEstado', { estado: 'error', usuario: usuarioTikTok, error: session.tiktokMensajeError });
            session.tiktokConnection = null;
        });

        connection.on('gift', (data) => {
            if (typeof procesarRegaloTikTokFn === 'function') {
                procesarRegaloTikTokFn(username, data);
            }
        });

        connection.on('chat', (data) => {
            io.to(username).emit('tiktokLiveEvent', { tipo: 'chat', usuario: data.uniqueId, comentario: data.comment, avatar: data.profilePictureUrl });
        });

        connection.on('like', (data) => {
            io.to(username).emit('tiktokLiveEvent', { tipo: 'like', usuario: data.uniqueId, cantidad: data.likeCount, avatar: data.profilePictureUrl });
        });

        connection.on('social', (data) => {
            const subtipo = data.displayType.includes('follow') ? 'follow' : 'share';
            io.to(username).emit('tiktokLiveEvent', { tipo: subtipo, usuario: data.uniqueId, descripcion: data.label, avatar: data.profilePictureUrl });
        });

        connection.on('member', (data) => {
            io.to(username).emit('tiktokLiveEvent', { tipo: 'join', usuario: data.uniqueId, avatar: data.profilePictureUrl });
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
        conectarTikTok(req.username, usuario);
        res.send('Conectando...');
    });

    app.all('/tiktok/desconectar', requireSession, (req, res) => {
        const s = req.userSession;
        if (s.tiktokConnection) {
            try { s.tiktokConnection.disconnect(); } catch (e) {}
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
