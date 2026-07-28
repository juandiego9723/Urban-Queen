const http = require('http');

const CANTIDAD_REGALOS = 2000;
const TIEMPO_SEGUNDOS = 5; // Enviar 2000 regalos distribuidos en 5 segundos
const QUEENS = ['Amy', 'Ray', 'Nucita', 'Venus'];

console.log(`🚀 Iniciando PRUEBA DE FUEGO...`);
console.log(`Enviando ${CANTIDAD_REGALOS} regalos simulados en ${TIEMPO_SEGUNDOS} segundos al servidor local...`);

let completados = 0;
let errores = 0;

function enviarRegaloSimulado(i) {
    const viewer = `tester_${Math.floor(Math.random() * 100)}`;
    const queen = QUEENS[Math.floor(Math.random() * QUEENS.length)];
    const puntos = 1; // Rosa simulada

    const data = JSON.stringify({ viewer, puntos, nombre: queen, avatar: 'https://via.placeholder.com/50' });
    
    const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/update',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    }, res => {
        res.on('data', () => {});
        res.on('end', () => {
            completados++;
            verificarFin();
        });
    });

    req.on('error', (e) => {
        errores++;
        verificarFin();
    });

    req.write(data);
    req.end();
}

function verificarFin() {
    if (completados + errores === CANTIDAD_REGALOS) {
        console.log(`\n✅ Prueba Finalizada!`);
        console.log(`✔️ Exitosos: ${completados}`);
        console.log(`❌ Errores: ${errores}`);
        if (errores === 0) {
            console.log(`\n🔥 ¡TikDance resistió la prueba de fuego perfectamente sin colapsar!`);
        }
    }
}

for (let i = 0; i < CANTIDAD_REGALOS; i++) {
    // Distribuir los envíos aleatoriamente a lo largo de los segundos configurados
    setTimeout(() => {
        enviarRegaloSimulado(i);
    }, Math.random() * (TIEMPO_SEGUNDOS * 1000));
}
