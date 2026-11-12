/**
 * Utilidades de zona horaria local y claves de período (día, semana ISO, mes).
 */
function getTimezone() {
    return process.env.TIMEZONE || 'America/Bogota';
}

function getLocalDateStrings(tz = getTimezone(), date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const diaStr = formatter.format(date);
    const mesStr = diaStr.substring(0, 7);

    const parts = formatter.formatToParts(date);
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);

    const target = new Date(Date.UTC(y, m, d));
    const dayNr = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNr);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    const semanaStr = `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

    return { diaStr, mesStr, semanaStr };
}

module.exports = {
    getTimezone,
    getLocalDateStrings
};

