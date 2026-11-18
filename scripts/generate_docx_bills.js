const fs = require('fs');
const path = require('path');
const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    HeadingLevel,
    BorderStyle
} = require('docx');

const borderNone = {
    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
    right: { style: BorderStyle.NONE, size: 0, color: "auto" }
};

const borderThin = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "D3D3D3" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "D3D3D3" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "D3D3D3" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "D3D3D3" }
};

function createHeaderBox(title, subtitle, clientName, docNumber) {
    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 120 },
            children: [
                new TextRun({
                    text: title,
                    bold: true,
                    size: 36, // 18pt
                    color: "1A365D"
                })
            ]
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 300 },
            children: [
                new TextRun({
                    text: subtitle,
                    italics: true,
                    size: 22, // 11pt
                    color: "4A5568"
                })
            ]
        }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderNone,
                            children: [
                                new Paragraph({
                                    children: [
                                        new TextRun({ text: "CLIENTE: ", bold: true, size: 20 }),
                                        new TextRun({ text: clientName, size: 20 })
                                    ]
                                }),
                                new Paragraph({
                                    children: [
                                        new TextRun({ text: "CONCEPTO: ", bold: true, size: 20 }),
                                        new TextRun({ text: "Desarrollo de Software, Overlays de Transmisión, Rankings y Gamificación TikTok Live", size: 20 })
                                    ]
                                }),
                                new Paragraph({
                                    children: [
                                        new TextRun({ text: "PERÍODO: ", bold: true, size: 20 }),
                                        new TextRun({ text: "01/10/2026 – 09/11/2026", size: 20 })
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderNone,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.RIGHT,
                                    children: [
                                        new TextRun({ text: "DOCUMENTO N°: ", bold: true, size: 20 }),
                                        new TextRun({ text: docNumber, size: 20, bold: true, color: "2B6CB0" })
                                    ]
                                }),
                                new Paragraph({
                                    alignment: AlignmentType.RIGHT,
                                    children: [
                                        new TextRun({ text: "FECHA DE EMISIÓN: ", bold: true, size: 20 }),
                                        new TextRun({ text: "09 de Noviembre de 2026", size: 20 })
                                    ]
                                }),
                                new Paragraph({
                                    alignment: AlignmentType.RIGHT,
                                    children: [
                                        new TextRun({ text: "ESTADO: ", bold: true, size: 20 }),
                                        new TextRun({ text: "Entregado / Por Liquidar", size: 20, bold: true, color: "38A169" })
                                    ]
                                })
                            ]
                        })
                    ]
                })
            ]
        }),
        new Paragraph({ spacing: { before: 200, after: 200 }, children: [] })
    ];
}

function createSectionTitle(title) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 120 },
        children: [
            new TextRun({
                text: title,
                bold: true,
                size: 24, // 12pt
                color: "2C5282"
            })
        ]
    });
}

function createBulletItem(boldText, normalText) {
    return new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 },
        children: [
            new TextRun({ text: boldText, bold: true, size: 20 }),
            new TextRun({ text: normalText, size: 20 })
        ]
    });
}

function createSummaryTable(headers, rows) {
    const tableRows = [];

    // Header row
    tableRows.push(
        new TableRow({
            tableHeader: true,
            children: headers.map(h => new TableCell({
                width: { size: h.width, type: WidthType.PERCENTAGE },
                shading: { fill: "2B6CB0" },
                borders: borderThin,
                children: [
                    new Paragraph({
                        alignment: h.align || AlignmentType.LEFT,
                        spacing: { before: 100, after: 100 },
                        children: [
                            new TextRun({
                                text: h.text,
                                bold: true,
                                size: 20,
                                color: "FFFFFF"
                            })
                        ]
                    })
                ]
            }))
        })
    );

    // Data rows
    rows.forEach((r, idx) => {
        const isTotalRow = r[0] === "--";
        const bg = isTotalRow ? "EDF2F7" : (idx % 2 === 0 ? "FFFFFF" : "F7FAFC");
        tableRows.push(
            new TableRow({
                children: r.map((cellText, cIdx) => new TableCell({
                    width: { size: headers[cIdx].width, type: WidthType.PERCENTAGE },
                    shading: { fill: bg },
                    borders: borderThin,
                    children: [
                        new Paragraph({
                            alignment: headers[cIdx].align || AlignmentType.LEFT,
                            spacing: { before: 80, after: 80 },
                            children: [
                                new TextRun({
                                    text: cellText,
                                    size: isTotalRow ? 20 : 19,
                                    bold: cIdx === 0 || cIdx === 2 || isTotalRow,
                                    color: isTotalRow ? "1A365D" : "000000"
                                })
                            ]
                        })
                    ]
                }))
            })
        );
    });

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: tableRows
    });
}

function createFooterSignature() {
    return [
        new Paragraph({ spacing: { before: 400, after: 100 }, children: [] }),
        new Paragraph({
            children: [
                new TextRun({ text: "DATOS BANCARIOS PARA PAGO:", bold: true, size: 20, color: "1A365D" })
            ]
        }),
        new Paragraph({
            children: [
                new TextRun({ text: "• Titular de la Cuenta: ", bold: true, size: 20 }),
                new TextRun({ text: "[ Nombre del Titular ]", size: 20 })
            ]
        }),
        new Paragraph({
            children: [
                new TextRun({ text: "• Documento / Cédula / NIT: ", bold: true, size: 20 }),
                new TextRun({ text: "[ Número de Documento ]", size: 20 })
            ]
        }),
        new Paragraph({
            children: [
                new TextRun({ text: "• Entidad Bancaria: ", bold: true, size: 20 }),
                new TextRun({ text: "[ Banco / Plataforma ]", size: 20 })
            ]
        }),
        new Paragraph({
            children: [
                new TextRun({ text: "• Tipo y Número de Cuenta: ", bold: true, size: 20 }),
                new TextRun({ text: "[ Ahorros / Corriente / N° de Cuenta ]", size: 20 })
            ]
        }),
        new Paragraph({ spacing: { before: 400, after: 100 }, children: [] }),
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderNone,
                            children: [
                                new Paragraph({
                                    children: [
                                        new TextRun({ text: "____________________________________\n", size: 20 }),
                                        new TextRun({ text: "FIRMA PRESTADOR DEL SERVICIO\n", bold: true, size: 20 }),
                                        new TextRun({ text: "Desarrollador / Ingeniero de Software", size: 18 })
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: borderNone,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.RIGHT,
                                    children: [
                                        new TextRun({ text: "____________________________________\n", size: 20 }),
                                        new TextRun({ text: "RECIBIDO Y APROBADO\n", bold: true, size: 20 }),
                                        new TextRun({ text: "Representante / Director de Agencia", size: 18 })
                                    ]
                                })
                            ]
                        })
                    ]
                })
            ]
        })
    ];
}

// -------------------------------------------------------------
// 1. GENERAR DOCUMENTO COSMIC
// -------------------------------------------------------------
async function buildCosmicDoc() {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 1200, bottom: 1200, left: 1400, right: 1400 }
                }
            },
            children: [
                ...createHeaderBox(
                    "CUENTA DE COBRO DE SERVICIOS",
                    "Desarrollo de Software, Overlays de Transmisión, Diseños Temáticos y Gamificación TikTok Live",
                    "AGENCIA COSMIC (slug: cosmic)",
                    "CC-2026-COSMIC-01"
                ),

                createSectionTitle("1. RESUMEN DEL SERVICIO"),
                new Paragraph({
                    spacing: { before: 60, after: 120 },
                    children: [
                        new TextRun({
                            text: "Por medio del presente documento se relacionan los servicios profesionales de ingeniería de software, arquitectura de sistemas, diseño de interfaces y desarrollo de overlays interactivos desarrollados e implementados exclusivamente para la AGENCIA COSMIC entre el 01 de Octubre de 2026 y el 09 de Noviembre de 2026. Los módulos fueron integrados con la API de TikTok Live, base de datos en la nube Supabase PostgreSQL, motor de personalización de títulos y colores en tiempo real, paquete temático de Halloween de Octubre, overlays dedicados de HUD Batalla, HUD Clásico, Goal Meter (Meta de Puntos) y Top Likes (Top Tappers) optimizados para OBS Studio y TikTok LIVE Studio.",
                            size: 20
                        })
                    ]
                }),

                createSectionTitle("2. DETALLE DE ENTREGABLES Y MÓDULOS DESARROLLADOS"),

                createBulletItem("Nuevo Overlay HUD Batalla para Cosmic (/cosmic/batalla y /cosmic/batalla-clasico): ", "Desarrollo del overlay exclusivo de batalla en vivo para Cosmic. Muestra el duelo entre bailarinas con barra segmentada de progreso de diamantes en tiempo real, efectos de animación para la líder, nuevo diseño de contador de victorias con insignias WIN, y compatibilidad total como fuente de navegador en OBS Studio."),

                createBulletItem("Nuevo Overlay HUD Clásico de Respaldo (/cosmic/ranking-clasico y /cosmic/batalla-clasico): ", "Desarrollo de versión clásica y minimalista para Cosmic. Diseñada especialmente para transmisiones estándar libres de animaciones pesadas o elementos de temporada, garantizando fluidez absoluta y bajo consumo de CPU/GPU en OBS Studio, con soporte de conmutación en caliente mediante el atajo de teclado 'H' y el parámetro '?theme=clasico'."),

                createBulletItem("Nuevo Overlay Goal Meter - Meta de Puntos (/overlay-goal y /cosmic/overlay-goal-clasico): ", "Desarrollo del overlay interactivo de metas en vivo con medidor semicircular tipo tacómetro (0% a 100%), acumulación progresiva de diamantes procedentes de regalos de TikTok Live y título editable ('Meta del Día'). Incluye módulo de control en el panel administrativo (/cosmic/control) con botones de ajuste rápido (+100, +500, +1000, +5000), persistencia en Supabase y reinicio inteligente al conectar un nuevo Live."),

                createBulletItem("Nuevo Overlay Top Likes - Top Tappers (/cosmic/overlay-top-likes): ", "Desarrollo del overlay dedicado para Cosmic con identidad visual en tonos rosado cósmico y blanco. Despliega en tiempo real la tabla de clasificación de los 5 usuarios que más toques en pantalla (likes / tap-tap) han dado durante la transmisión, tarjeta destacada para el MVP con foto de perfil y sincronización instantánea por WebSockets."),

                createBulletItem("Personalización Completa de Títulos y Colores de los Rankings: ", "Módulo en el panel de control (/cosmic/control) que permite renombrar y cambiar el color HEX de los títulos de cada ranking: Semanal, Mensual, Diario y Torneo Revivir/Salvación. Incluye paleta de color interactiva (color picker), persistencia en base de datos Supabase (tabla config: ranking_titulos), sincronización instantánea por WebSocket (rankingTitulosActualizados) y renderizado reactivo con sombras neón adaptativas."),

                createBulletItem("Paquete de Diseño Temático Halloween (Edición Especial Octubre): ", "Diseño completo de temporada implementado durante octubre. Incluye: 1) Rediseño de Ranking Halloween Neón con marco de doble línea violeta y naranja neón, accesorio superior de calabaza animada con parpadeo luminoso (pumpkin-roof), gotas de slime goteante superior e inferior (drip-top/bottom) y telaraña neón. 2) Rediseño de Batalla Halloween Neón con resplandor pulsante naranja en la barra central, telarañas de esquina e indicadores de victorias con calabazas (🎃). 3) Overlays complementarios adaptados (Goal Meter con fuego neón y Top Likes con tarjeta MVP temática)."),

                createBulletItem("Módulo Batalla 1 vs 1 (/batalla-vs): ", "Desarrollo completo de overlay para duelos cara a cara con avatares circulares y regalos activadores en 3D. Incorpora modo Bono 2X de 45 segundos aislado a la batalla, celebración de victoria con corona 3D dorada, confeti y desaturación/escala de grises en la perdedora. Integración con selector 1 vs 1 en panel de control."),

                createBulletItem("Dinámica de Regalos Activadores (/cosmic/dinamica-activadores): ", "Overlay horizontal con barras segmentadas para lectura óptima en móviles, resaltado en oro del líder con destello divisor en tiempo real y cola de impacto independiente."),

                createBulletItem("Módulo Batalla Normal V2 (/batalla-normal-v2): ", "Diseño con píldoras segmentadas independientes, tipografía oficial TikTok Sans, cápsula de cronómetro MM:SS con alerta pulsante roja en los últimos 10 segundos y despliegue progresivo de MVPs."),

                createBulletItem("Dinámica de Podio (/cosmic/podio y /cosmic/ranking-podio): ", "Módulo backend dedicado (src/dynamics/podio.js) con ciclo de vida completo. HUD estilo grafito mate con barra de progreso arcoíris, ranking con coronas vectoriales (1º, 2º y 3º lugar) y fila dorada para la bailarina activa. Persistencia en base de datos Supabase (podio_ranking)."),

                createBulletItem("Dinámica Conociendo Cosmic (/cosmic/conociendo y /cosmic/ranking-conociendo): ", "Modo presentación fija sin pantallas de corte al expirar el tiempo (00:00). Mensajes reactivos neón '¡LOGRADO!' o 'GRACIAS', animación de confeti de victoria, sincronización de metas individuales decrecientes por bailarina y botón para marcar estado OUT."),

                createBulletItem("Panel de Control y Sincronización WebSockets (/cosmic/control): ", "Implementación del botón '⚡ Asignar todos a bailarina activa' para procesar en un clic regalos acumulados sin mapear, limpieza automática de estados en conflicto (limpiarEstadosEnConflictoConPodio) y puente de sockets (eventQueue / iframe-bridge) con cero pérdida de eventos."),

                createSectionTitle("3. LIQUIDACIÓN DE HONORARIOS"),
                createSummaryTable(
                    [
                        { text: "Ítem", width: 10, align: AlignmentType.CENTER },
                        { text: "Módulo / Entregable", width: 50, align: AlignmentType.LEFT },
                        { text: "Estado", width: 20, align: AlignmentType.CENTER },
                        { text: "Valor", width: 20, align: AlignmentType.RIGHT }
                    ],
                    [
                        ["01", "Nuevo Overlay HUD Batalla Cosmic (/cosmic/batalla y /cosmic/batalla-clasico)", "Completado", "[ $ Indicar Valor ]"],
                        ["02", "Nuevo Overlay HUD Clásico de Respaldo (/cosmic/ranking-clasico)", "Completado", "[ $ Indicar Valor ]"],
                        ["03", "Nuevo Overlay Goal Meter - Meta de Puntos (/overlay-goal)", "Completado", "[ $ Indicar Valor ]"],
                        ["04", "Nuevo Overlay Top Likes - Top Tappers (/cosmic/overlay-top-likes)", "Completado", "[ $ Indicar Valor ]"],
                        ["05", "Personalización de Títulos y Colores de Rankings (Semanal, Mensual, Diario, Revivir)", "Completado", "[ $ Indicar Valor ]"],
                        ["06", "Paquete de Diseño Temático Halloween (Ranking Neón, Batalla y Overlays)", "Completado", "[ $ Indicar Valor ]"],
                        ["07", "Módulo Batalla 1 vs 1 (/batalla-vs, Bono 2X, Corona 3D y Victoria)", "Completado", "[ $ Indicar Valor ]"],
                        ["08", "Dinámica de Regalos Activadores (HUD Horizontal + Leaderboard Dorado)", "Completado", "[ $ Indicar Valor ]"],
                        ["09", "Módulo Batalla Normal V2 (Overlay, TikTok Sans, Alerta 10s)", "Completado", "[ $ Indicar Valor ]"],
                        ["10", "Dinámica de Podio (HUD + Ranking + Backend + Supabase)", "Completado", "[ $ Indicar Valor ]"],
                        ["11", "Dinámica Conociendo Cosmic (Modo presentación, Confeti, Metas)", "Completado", "[ $ Indicar Valor ]"],
                        ["12", "Panel de Control, Asignación Masiva y Sincronización WebSockets", "Completado", "[ $ Indicar Valor ]"],
                        ["--", "TOTAL A COBRAR (AGENCIA COSMIC):", "TOTAL", "[ $ TOTAL ]"]
                    ]
                ),

                ...createFooterSignature()
            ]
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    const outputPath = path.join(__dirname, '..', 'Cuenta_de_Cobro_Cosmic_Agency.docx');
    fs.writeFileSync(outputPath, buffer);
    console.log(`✓ Archivo creado: ${outputPath}`);
}

// -------------------------------------------------------------
// 2. GENERAR DOCUMENTO URBAN QUEENS
// -------------------------------------------------------------
async function buildUrbanDoc() {
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 1200, bottom: 1200, left: 1400, right: 1400 }
                }
            },
            children: [
                ...createHeaderBox(
                    "CUENTA DE COBRO DE SERVICIOS",
                    "Desarrollo de Software, Gestor de Listas, Diseños Temáticos, Rankings y Cloud",
                    "URBAN QUEENS AGENCY (slug: urbanqueens)",
                    "CC-2026-URBAN-01"
                ),

                createSectionTitle("1. RESUMEN DEL SERVICIO"),
                new Paragraph({
                    spacing: { before: 60, after: 120 },
                    children: [
                        new TextRun({
                            text: "Por medio del presente documento se relacionan los servicios profesionales de ingeniería de software, arquitectura de bases de datos, diseño de interfaces y desarrollo de overlays interactivos desarrollados e implementados exclusivamente para URBAN QUEENS AGENCY entre el 01 de Octubre de 2026 y el 09 de Noviembre de 2026. Los módulos fueron integrados con la API de TikTok Live, base de datos en la nube Supabase PostgreSQL, motor de personalización de títulos y colores en tiempo real, paquete temático de Halloween de Octubre, overlays dedicados de HUD Batalla, HUD Clásico, Goal Meter (Meta de Puntos), Top Likes (Top Tappers), gestor de listas con Drag & Drop y Google Cloud Run para transmisiones fluidas en OBS Studio.",
                            size: 20
                        })
                    ]
                }),

                createSectionTitle("2. DETALLE DE ENTREGABLES Y MÓDULOS DESARROLLADOS"),

                createBulletItem("Nuevo Overlay HUD Batalla para Urban Queens (/batalla y /batalla-clasico): ", "Desarrollo del overlay de batalla en vivo para Urban Queens. Visualización en directo del duelo entre Queens, barra segmentada de progreso de diamantes, efectos luminosos para la líder, rediseño del contador de victorias con insignias WIN y sincronización completa como fuente de navegador en OBS Studio."),

                createBulletItem("Nuevo Overlay HUD Clásico de Respaldo (/ranking-clasico y /batalla-clasico): ", "Desarrollo de versión clásica y minimalista para Urban Queens. Permite emitir con un diseño limpio, ligero y sin elementos pesados de temporada, garantizando estabilidad óptima y mínimo consumo de CPU/GPU en OBS Studio, con soporte de alternancia instantánea mediante tecla 'H' o parámetro '?theme=clasico'."),

                createBulletItem("Nuevo Overlay Goal Meter - Meta de Puntos (/overlay-goal y /overlay-goal-clasico): ", "Desarrollo del overlay interactivo de metas en vivo con medidor semicircular tipo tacómetro (0% a 100%), barra de progreso reactiva a los regalos de TikTok Live y título editable ('Meta del Día'). Integrado con tarjeta de gestión en panel de control (/control.html) con botones de suma rápida (+100, +500, +1000, +5000), guardado persistente en Supabase y reinicio inteligente al conectar nueva transmisión."),

                createBulletItem("Nuevo Overlay Top Likes - Top Tappers (/overlay-top-likes): ", "Desarrollo del overlay dedicado para Urban Queens con identidad de marca en morado/violeta y detalles dorados. Visualización en vivo del Top 5 de usuarios con mayor número de likes (toques de pantalla / tap-tap), tarjeta MVP destacada con foto de perfil y sincronización en tiempo real vía WebSockets."),

                createBulletItem("Personalización Completa de Títulos y Colores de los Rankings: ", "Implementación en el panel de control (/control.html) del gestor dinámico de nombres y colores para los rankings. Permite cambiar títulos y colores HEX personalizados para el Ranking Semanal, Mensual, Diario y Torneo Revivir. Sincronizado en tiempo real vía Socket.IO (evento rankingTitulosActualizados), persistido en base de datos Supabase y renderizado en vivo en los overlays con sombras y efectos neón reactivos."),

                createBulletItem("Paquete de Diseño Temático Halloween (Edición Especial Octubre): ", "Desarrollo y aplicación de la temática interactiva de Halloween durante octubre. Comprende: 1) Rediseño de Ranking Halloween Neón con marco exterior naranja brillante y doble reborde púrpura neón, accesorio de calabaza animada flicker en cabecera (pumpkin-roof), gotas goteantes de slime naranja (drip-top y drip-bottom) y telaraña neón glow. 2) Rediseño de Batalla Halloween con resplandor neón naranja, borde luminoso en la barra central y conteo de victorias con calabazas (🎃). 3) Overlays Goal Meter con fuego neón y Top Likes con tarjeta MVP temáticos."),

                createBulletItem("Gestor de Regalos Custom con Múltiples Listas y Drag & Drop: ", "Arquitectura de base de datos relacional (regalos_listas y lista_id en regalos_custom) en PostgreSQL/Supabase. Creación y gestión de múltiples listas temáticas en panel de control (control.html), activación de lista para stream con un solo clic, sistema Drag & Drop para reordenar regalos arrastrándolos y sincronización en tiempo real con OBS (/gestor-regalos) vía WebSockets."),

                createBulletItem("Dinámica de HUD Activadores (/dinamica-activadores): ", "Overlay horizontal con seguimiento exclusivo en tiempo real de los regalos activadores de cada Queen, conteo de impactos instantáneos y animaciones reactivas al recibir donaciones."),

                createBulletItem("Módulo Batalla 1 vs 1 (/batalla-vs): ", "Overlay cara a cara con avatares circulares, activadores 3D, multiplicador Bono 2X de 45 segundos aislado de la base de datos fija y celebración cinematográfica con corona 3D dorada, confeti y desaturación en la perdedora."),

                createBulletItem("Dinámicas de Fútbol y Penaltis Interactivos (/batalla-futbol, /batalla-pk): ", "Marcador interactivo de equipos configurables (Barça vs Real Madrid, PSG con franja Hechter) y dinamización de tiro penal con física 2D y resolución de gol o atajada según donaciones."),

                createBulletItem("Dinámica de Podio & Conociendo Grafito Mate: ", "Overlays adaptados de 480px / 440px en negro grafito mate con coronas vectoriales (1º-3º), fila dorada para el líder y puntuación desacoplada del ranking general."),

                createBulletItem("Optimizaciones Críticas de Rendimiento (Cloud Run & Supabase): ", "Solución integral a caídas por 'Rate Exceeded' mediante WebSockets directos y throttling (2.5s). Deduplicación de combos 10x10 por msgId para evitar duplicación de puntos en ráfagas. Botón '⚡ Asignar todos a bailarina activa' en panel de control."),

                createSectionTitle("3. LIQUIDACIÓN DE HONORARIOS"),
                createSummaryTable(
                    [
                        { text: "Ítem", width: 10, align: AlignmentType.CENTER },
                        { text: "Módulo / Entregable", width: 50, align: AlignmentType.LEFT },
                        { text: "Estado", width: 20, align: AlignmentType.CENTER },
                        { text: "Valor", width: 20, align: AlignmentType.RIGHT }
                    ],
                    [
                        ["01", "Nuevo Overlay HUD Batalla Urban Queens (/batalla y /batalla-clasico)", "Completado", "[ $ Indicar Valor ]"],
                        ["02", "Nuevo Overlay HUD Clásico de Respaldo (/ranking-clasico)", "Completado", "[ $ Indicar Valor ]"],
                        ["03", "Nuevo Overlay Goal Meter - Meta de Puntos (/overlay-goal)", "Completado", "[ $ Indicar Valor ]"],
                        ["04", "Nuevo Overlay Top Likes - Top Tappers (/overlay-top-likes)", "Completado", "[ $ Indicar Valor ]"],
                        ["05", "Personalización de Títulos y Colores de Rankings (Semanal, Mensual, Diario, Revivir)", "Completado", "[ $ Indicar Valor ]"],
                        ["06", "Paquete de Diseño Temático Halloween (Ranking Neón, Batalla y Overlays)", "Completado", "[ $ Indicar Valor ]"],
                        ["07", "Gestor de Regalos Custom (Múltiples Listas, Drag & Drop, Sync OBS)", "Completado", "[ $ Indicar Valor ]"],
                        ["08", "Dinámica de HUD Activadores (Overlay Horizontal + Tracking en Vivo)", "Completado", "[ $ Indicar Valor ]"],
                        ["09", "Módulo Batalla 1 vs 1 (/batalla-vs, Bono 2X, Corona 3D y Victoria)", "Completado", "[ $ Indicar Valor ]"],
                        ["10", "Dinámicas de Fútbol & Penaltis Interactivos (HUDs + Física 2D)", "Completado", "[ $ Indicar Valor ]"],
                        ["11", "Dinámica de Podio y Conociendo Grafito Mate (HUD + Coronas)", "Completado", "[ $ Indicar Valor ]"],
                        ["12", "Optimizaciones de Servidor Cloud Run, WebSockets y Deduplicación 10x10", "Completado", "[ $ Indicar Valor ]"],
                        ["--", "TOTAL A COBRAR (URBAN QUEENS):", "TOTAL", "[ $ TOTAL ]"]
                    ]
                ),

                ...createFooterSignature()
            ]
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    const outputPath = path.join(__dirname, '..', 'Cuenta_de_Cobro_Urban_Queens.docx');
    fs.writeFileSync(outputPath, buffer);
    console.log(`✓ Archivo creado: ${outputPath}`);
}

async function main() {
    try {
        await buildCosmicDoc();
        await buildUrbanDoc();
        console.log('🎉 Documentos Word regenerados exitosamente con HUD Clásico, HUD Batalla, Goal Meter y Top Likes desglosados para cada agencia.');
    } catch (e) {
        console.error('Error generando documentos Word:', e);
    }
}

main();
