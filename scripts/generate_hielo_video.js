/**
 * Generador de Video WebM con Canal Alfa (VP9 yuva420p)
 * Efecto: Hielo / Cristales creciendo progresivamente desde los bordes hacia el centro
 * Resolución: 1080x1920 (9:16 vertical) @ 24 fps, 4.0 segundos (96 fotogramas)
 */
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    ffmpegPath = 'ffmpeg';
}

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
const DURATION_SEC = 4.0;
const TOTAL_FRAMES = Math.round(FPS * DURATION_SEC); // 96 frames

const DEFAULT_TEXTURE = path.join(
    'C:', 'Users', 'USER', '.gemini', 'antigravity', 'brain',
    '4b46cde8-3074-462a-add7-3b794e1f3991',
    'ice_texture_base_1795476574011.jpg'
);

const texturePath = process.argv[2] || DEFAULT_TEXTURE;
const outputPath = process.argv[3] || path.join(__dirname, '..', 'public', 'regalos', 'hielo_cristal_transparente.webm');

if (!fs.existsSync(texturePath)) {
    console.error('❌ No se encontró la textura base de hielo:', texturePath);
    process.exit(1);
}

console.log('❄️  1/3 Decodificando textura base de cristales HD a buffer RGB...');
const decodeRes = spawnSync(ffmpegPath, [
    '-v', 'error',
    '-i', texturePath,
    '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-'
], { maxBuffer: WIDTH * HEIGHT * 4 });

if (decodeRes.status !== 0 || !decodeRes.stdout || decodeRes.stdout.length < WIDTH * HEIGHT * 3) {
    console.error('❌ Error decodificando textura base:', decodeRes.stderr ? decodeRes.stderr.toString() : '');
    process.exit(1);
}

const srcRgb = decodeRes.stdout;
const numPixels = WIDTH * HEIGHT;

// Precalcular mapas por píxel para rendimiento rápido en los 96 frames:
// - baseR, baseG, baseB: color des-multiplicado del cristal (sin fondo negro)
// - baseA: opacidad máxima del cristal en ese píxel (0..1)
// - growthOrder: momento normalizado (0..1) en que el hielo alcanza este píxel desde el borde hacia el centro
// - angleMap: ángulo polar desde el centro
const baseR = new Uint8Array(numPixels);
const baseG = new Uint8Array(numPixels);
const baseB = new Uint8Array(numPixels);
const baseA = new Float32Array(numPixels);
const growthOrder = new Float32Array(numPixels);
const shimmerPhase = new Float32Array(numPixels);

const cx = WIDTH * 0.5;
const cy = HEIGHT * 0.5;

// Función de ruido pseudo-aleatorio suave (fractal angular + espacial)
function fractalNoise(x, y, angle) {
    const n1 = Math.sin(angle * 7.0) * 0.35 + Math.cos(angle * 13.0 + 1.2) * 0.25 + Math.sin(angle * 23.0 - 0.7) * 0.15;
    const n2 = Math.sin(x * 0.018 + y * 0.014) * 0.15 + Math.cos(x * 0.035 - y * 0.028) * 0.1;
    return n1 + n2; // ~ [-1, 1]
}

console.log('🧊 2/3 Calculando campo de crecimiento cristalino desde los bordes hacia el centro...');

for (let y = 0; y < HEIGHT; y++) {
    // Distancia normalizada al borde más cercano (0 en los bordes, 1 en el centro)
    const distLeft = x => x / (WIDTH * 0.5);
    const dyEdge = Math.min(y, HEIGHT - 1 - y) / (HEIGHT * 0.5);

    for (let x = 0; x < WIDTH; x++) {
        const idx = y * WIDTH + x;
        const rgbIdx = idx * 3;
        const r = srcRgb[rgbIdx];
        const g = srcRgb[rgbIdx + 1];
        const b = srcRgb[rgbIdx + 2];

        // Luminancia helada priorizando cian y azul-blanco
        const maxC = Math.max(r, g, b);
        const lum = (0.22 * r + 0.50 * g + 0.28 * b) / 255.0;
        const maxNorm = maxC / 255.0;

        // Extraer canal alfa limpio eliminando el fondo negro puro
        // Umbral suave debajo de 0.06 para que el centro sea 100% transparente
        let alpha = 0;
        if (maxNorm > 0.05) {
            alpha = Math.min(1.0, Math.pow((maxNorm - 0.05) / 0.82, 0.78));
        }

        if (alpha > 0.005) {
            // Des-multiplicar el negro del fondo para que los bordes semitransparentes sean blanco/cian puro y nunca gris oscuro
            const invA = 1.0 / Math.max(0.18, maxNorm);
            const cleanR = Math.min(255, Math.round(r * invA * 0.92 + 20));
            const cleanG = Math.min(255, Math.round(g * invA * 0.96 + 15));
            const cleanB = Math.min(255, Math.round(b * invA * 1.00 + 25));

            baseR[idx] = cleanR;
            baseG[idx] = cleanG;
            baseB[idx] = cleanB;
            baseA[idx] = alpha;
        }

        // Distancia desde los 4 bordes hacia el centro (0.0 en el marco exterior, ~0.75 en las puntas centrales)
        const dxEdge = Math.min(x, WIDTH - 1 - x) / (WIDTH * 0.5);
        // Combinación de distancia euclidiana elíptica y distancia al borde rectangular
        const nx = (x - cx) / cx; // -1..1
        const ny = (y - cy) / cy; // -1..1
        const radialFromCenter = Math.min(1.35, Math.sqrt(nx * nx * 0.95 + ny * ny * 0.85));
        const distFromEdgeRadial = Math.max(0.0, 1.18 - radialFromCenter); // 0 en esquinas/bordes, >0.6 hacia el centro
        const distFromBoxEdge = Math.min(dxEdge, dyEdge * 1.25); // 0 en cualquier borde

        const edgeMetric = distFromBoxEdge * 0.58 + distFromEdgeRadial * 0.42;

        // Las venas más gruesas/brillantes cerca del borde crecen primero; las puntas finas dendríticas hacia el centro llegan al final
        const angle = Math.atan2(ny, nx);
        const fNoise = fractalNoise(x, y, angle);
        const crystalDelay = (1.0 - lum) * 0.14; // el núcleo del cristal avanza ligeramente antes que las ramitas finas

        // growthOrder: 0.0 = aparece al instante en el borde exterior, 1.0 = termina de crecer en las puntas centrales
        const order = Math.max(0.0, Math.min(1.0, edgeMetric * 1.32 + crystalDelay + fNoise * 0.055));
        growthOrder[idx] = order;

        // Fase para el destello especular (shimmer diagonal)
        shimmerPhase[idx] = (x / WIDTH) * 0.65 + (y / HEIGHT) * 0.35;
    }
}

// Generar partículas de nieve, micro-cristales y destellos que brotan de los bordes hacia el centro
const NUM_PARTICLES = 110;
const particles = [];
for (let i = 0; i < NUM_PARTICLES; i++) {
    // Nacen cerca de los bordes y flotan hacia adentro / abajo
    const side = i % 4; // 0: izq, 1: der, 2: arriba, 3: abajo
    let startX, startY, vx, vy;
    const rand1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const rand2 = Math.abs(Math.sin(i * 78.233) * 19341.123) % 1;
    const rand3 = Math.abs(Math.cos(i * 45.164) * 28411.871) % 1;

    if (side === 0) {
        startX = rand1 * 180;
        startY = rand2 * HEIGHT;
        vx = 35 + rand3 * 55;
        vy = -15 + rand1 * 60;
    } else if (side === 1) {
        startX = WIDTH - rand1 * 180;
        startY = rand2 * HEIGHT;
        vx = -(35 + rand3 * 55);
        vy = -15 + rand1 * 60;
    } else if (side === 2) {
        startX = rand2 * WIDTH;
        startY = rand1 * 240;
        vx = (rand3 - 0.5) * 60;
        vy = 45 + rand1 * 75;
    } else {
        startX = rand2 * WIDTH;
        startY = HEIGHT - rand1 * 240;
        vx = (rand3 - 0.5) * 60;
        vy = -(35 + rand1 * 60);
    }

    particles.push({
        startX,
        startY,
        vx,
        vy,
        radius: 2.2 + (i % 5) * 1.35,
        isSparkle: i % 3 === 0,
        appearAt: (i / NUM_PARTICLES) * 0.55, // aparecen escalonadas durante el crecimiento
        freq: 2.0 + rand3 * 4.0,
        phase: rand1 * Math.PI * 2
    });
}

// Dibujar partícula o destello diamantino en el buffer RGBA
function drawParticle(buf, px, py, radius, alpha, isSparkle) {
    const cxP = Math.round(px);
    const cyP = Math.round(py);
    const rInt = Math.ceil(radius * (isSparkle ? 2.2 : 1.4));

    for (let dy = -rInt; dy <= rInt; dy++) {
        const y = cyP + dy;
        if (y < 0 || y >= HEIGHT) continue;
        for (let dx = -rInt; dx <= rInt; dx++) {
            const x = cxP + dx;
            if (x < 0 || x >= WIDTH) continue;

            let intensity = 0;
            if (isSparkle) {
                // Estrella de 4 puntas (destello de cristal)
                const ax = Math.abs(dx);
                const ay = Math.abs(dy);
                const dist = Math.sqrt(dx * dx + dy * dy);
                const core = Math.max(0, 1.0 - dist / (radius * 1.1));
                const spikeX = ay <= 1.2 ? Math.max(0, 1.0 - ax / (radius * 2.2)) : 0;
                const spikeY = ax <= 1.2 ? Math.max(0, 1.0 - ay / (radius * 2.2)) : 0;
                intensity = Math.min(1.0, core + Math.max(spikeX, spikeY) * 0.85);
            } else {
                // Copo de nieve suave
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;
                intensity = Math.pow(1.0 - dist / radius, 1.5);
            }

            if (intensity <= 0.01) continue;
            const pA = intensity * alpha;
            const pIdx = (y * WIDTH + x) * 4;

            const oldA = buf[pIdx + 3] / 255.0;
            const outA = pA + oldA * (1.0 - pA);
            if (outA > 0) {
                buf[pIdx] = Math.min(255, Math.round((235 * pA + buf[pIdx] * oldA * (1.0 - pA)) / outA));
                buf[pIdx + 1] = Math.min(255, Math.round((250 * pA + buf[pIdx + 1] * oldA * (1.0 - pA)) / outA));
                buf[pIdx + 2] = Math.min(255, Math.round((255 * pA + buf[pIdx + 2] * oldA * (1.0 - pA)) / outA));
                buf[pIdx + 3] = Math.min(255, Math.round(outA * 255));
            }
        }
    }
}

console.log('🎬 3/3 Renderizando 96 fotogramas RGBA y codificando a WebM VP9 (yuva420p)...');
console.log('   Destino:', outputPath);

const ffArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${WIDTH}x${HEIGHT}`,
    '-r', String(FPS),
    '-i', '-',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-auto-alt-ref', '0',
    '-crf', '24',
    '-b:v', '0',
    '-deadline', 'good',
    '-cpu-used', '3',
    '-an',
    outputPath
];

const ffProc = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

const frameBuf = Buffer.allocUnsafe(WIDTH * HEIGHT * 4);

// Función easeOutCubic para que el hielo irrumpa rápido desde los bordes y desacelere al cristalizar las puntas centrales
function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 2.6);
}

let currentFrame = 0;

function writeNextFrame() {
    while (currentFrame < TOTAL_FRAMES) {
        const t = currentFrame / (TOTAL_FRAMES - 1); // 0.0 -> 1.0
        const timeSec = currentFrame / FPS;

        // Fase 1 (0.0s a 2.5s -> t de 0 a 0.625): Crecimiento de los bordes hacia el centro
        // Fase 2 (2.5s a 4.0s -> t de 0.625 a 1.0): Hielo totalmente expandido con destello helado y pulso cristalino
        const growthRaw = Math.min(1.0, t / 0.62);
        const front = easeOutCubic(growthRaw) * 1.06; // 0.0 -> 1.06

        // Escala radial sutil: al inicio los cristales emergen expandiéndose desde los bordes exteriores (zoom 1.07 -> 1.00)
        const zoomOut = 1.0 + (1.0 - easeOutCubic(growthRaw)) * 0.065;
        const invZoom = 1.0 / zoomOut;

        // Barrido de luz especular (shimmer) que recorre el hielo
        const shimmerPos = (t * 1.45) % 1.3 - 0.15;

        // Pulso frío de respiración en los bordes
        const coldPulse = 0.96 + 0.04 * Math.sin(timeSec * Math.PI * 1.5);

        for (let y = 0; y < HEIGHT; y++) {
            const sy = Math.min(HEIGHT - 1, Math.max(0, Math.round(cy + (y - cy) * invZoom)));
            const rowOffset = y * WIDTH;
            const sRowOffset = sy * WIDTH;

            for (let x = 0; x < WIDTH; x++) {
                const sx = Math.min(WIDTH - 1, Math.max(0, Math.round(cx + (x - cx) * invZoom)));
                const sIdx = sRowOffset + sx;
                const outIdx = (rowOffset + x) * 4;

                const targetA = baseA[sIdx];
                if (targetA <= 0.005) {
                    frameBuf[outIdx] = 0;
                    frameBuf[outIdx + 1] = 0;
                    frameBuf[outIdx + 2] = 0;
                    frameBuf[outIdx + 3] = 0;
                    continue;
                }

                const gOrder = growthOrder[sIdx];
                const diff = front - gOrder;

                if (diff <= 0) {
                    // El frente de congelamiento aún no ha llegado a esta distancia del centro
                    frameBuf[outIdx] = 0;
                    frameBuf[outIdx + 1] = 0;
                    frameBuf[outIdx + 2] = 0;
                    frameBuf[outIdx + 3] = 0;
                    continue;
                }

                // Transición suave pero definida en la punta de crecimiento (banda de cristalización)
                const bandWidth = 0.11;
                const localGrowth = Math.min(1.0, diff / bandWidth);

                // Brillo extra de escarcha recién formada en la punta del frente de avance
                let tipGlow = 0;
                if (diff > 0 && diff < bandWidth * 1.35 && growthRaw < 1.0) {
                    tipGlow = Math.sin((diff / (bandWidth * 1.35)) * Math.PI) * 0.55;
                }

                // Brillo especular cuando el barrido de luz cruza las facetas del cristal
                const sDist = Math.abs(shimmerPhase[sIdx] - shimmerPos);
                const shimmerBoost = sDist < 0.12 ? (1.0 - sDist / 0.12) * 0.32 : 0;

                const totalBoost = tipGlow + shimmerBoost;

                const r = Math.min(255, Math.round(baseR[sIdx] + totalBoost * 110));
                const g = Math.min(255, Math.round(baseG[sIdx] + totalBoost * 95));
                const b = Math.min(255, Math.round(baseB[sIdx] + totalBoost * 80));

                const finalAlpha = Math.min(1.0, targetA * localGrowth * coldPulse + tipGlow * targetA * 0.35);

                frameBuf[outIdx] = r;
                frameBuf[outIdx + 1] = g;
                frameBuf[outIdx + 2] = b;
                frameBuf[outIdx + 3] = Math.round(finalAlpha * 255);
            }
        }

        // Dibujar partículas de escarcha y destellos moviéndose desde los bordes hacia el centro
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const p = particles[i];
            if (t < p.appearAt) continue;
            const localT = (t - p.appearAt) / (1.0 - p.appearAt);
            const ageSec = localT * DURATION_SEC * 0.75;

            const px = p.startX + p.vx * ageSec + Math.sin(ageSec * p.freq + p.phase) * 14;
            const py = p.startY + p.vy * ageSec + Math.cos(ageSec * p.freq * 0.8 + p.phase) * 10;

            // Fade in al nacer y fade suave al final para evitar cortes bruscos
            const fadeIn = Math.min(1.0, localT * 4.5);
            const fadeOut = t > 0.85 ? Math.max(0.2, 1.0 - (t - 0.85) / 0.18) : 1.0;
            const twinkle = 0.55 + 0.45 * Math.sin(timeSec * p.freq * 2.2 + p.phase);
            const pAlpha = fadeIn * fadeOut * twinkle * 0.85;

            drawParticle(frameBuf, px, py, p.radius, pAlpha, p.isSparkle);
        }

        currentFrame++;
        if (currentFrame % 16 === 0 || currentFrame === TOTAL_FRAMES) {
            console.log(`   Progreso: ${currentFrame}/${TOTAL_FRAMES} fotogramas (${Math.round((currentFrame / TOTAL_FRAMES) * 100)}%)`);
        }

        const canContinue = ffProc.stdin.write(frameBuf);
        if (!canContinue) {
            ffProc.stdin.once('drain', writeNextFrame);
            return;
        }
    }

    ffProc.stdin.end();
}

ffProc.on('close', (code) => {
    if (code !== 0) {
        console.error('❌ FFmpeg finalizó con código de error:', code);
        process.exit(code || 1);
    }
    const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Video WebM con transparencia generado exitosamente: ${outputPath} (${sizeMB} MB)`);
});

writeNextFrame();
