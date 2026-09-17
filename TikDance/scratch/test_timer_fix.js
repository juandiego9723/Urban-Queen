const http = require('http');

function makeReq(path) {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3000' + path, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function runTest() {
    try {
        console.log("1. Starting timer with 10 seconds per coin...");
        const startRes = await makeReq('/timer/start?t=30&s=10');
        console.log("Start res:", startRes);

        console.log("2. Checking /timer/status...");
        const statusRes1 = await makeReq('/timer/status');
        console.log("Status 1:", statusRes1);

        console.log("3. Skipping to next dancer...");
        const skipRes = await makeReq('/timer/skip');
        console.log("Skip res:", skipRes);

        console.log("4. Checking /timer/status during transition...");
        const statusRes2 = await makeReq('/timer/status');
        console.log("Status 2:", statusRes2);

        console.log("5. Stopping timer...");
        const stopRes = await makeReq('/timer/stop');
        console.log("Stop res:", stopRes);

        console.log("✅ TEST SUCCESSFUL");
    } catch (err) {
        console.error("❌ TEST FAILED:", err);
    }
}

runTest();
