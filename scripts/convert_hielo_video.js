const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    ffmpegPath = 'ffmpeg';
}

const inputPath = path.join(__dirname, '..', 'public', 'regalos', 'hielo_animado_suave_transparente.mov');
const outputPath = path.join(__dirname, '..', 'public', 'regalos', 'hielo_animado_suave_transparente.webm');

if (!fs.existsSync(inputPath)) {
    console.error('❌ No se encontró el archivo fuente:', inputPath);
    process.exit(1);
}

console.log('🎬 Convirtiendo a WebM con canal Alfa (VP9) para OBS Browser Source...');
console.log('   Origen:', inputPath);
console.log('   Destino:', outputPath);

const args = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-auto-alt-ref', '0',
    '-crf', '28',
    '-b:v', '0',
    '-deadline', 'good',
    '-cpu-used', '3',
    '-an',
    outputPath
];

const res = spawnSync(ffmpegPath, args, { stdio: 'inherit' });
if (res.status !== 0) {
    console.error('❌ Error en la conversión de video. Código:', res.status);
    process.exit(res.status || 1);
}

const inMB = (fs.statSync(inputPath).size / (1024 * 1024)).toFixed(2);
const outMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
console.log(`✅ Conversión completada con éxito: ${inMB} MB (.mov) -> ${outMB} MB (.webm con transparencia)`);
