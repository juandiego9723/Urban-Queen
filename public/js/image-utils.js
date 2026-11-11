(function(global) {
    function leerComoDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    }

    /**
     * Comprime y redimensiona una imagen a WebP en el navegador manteniendo transparencia.
     * Mantiene intactos los GIF animados y SVG.
     */
    async function comprimirImagenWebP(file, maxSize = 512, quality = 0.82) {
        if (!file) return '';
        const type = (file.type || '').toLowerCase();
        if (type === 'image/gif' || type === 'image/svg+xml') {
            return leerComoDataURL(file);
        }

        try {
            const objectUrl = URL.createObjectURL(file);
            try {
                const img = await new Promise((resolve, reject) => {
                    const el = new Image();
                    el.onload = () => resolve(el);
                    el.onerror = reject;
                    el.src = objectUrl;
                });

                let w = img.naturalWidth || img.width || maxSize;
                let h = img.naturalHeight || img.height || maxSize;
                if (w > maxSize || h > maxSize) {
                    if (w >= h) {
                        h = Math.max(1, Math.round((h * maxSize) / w));
                        w = maxSize;
                    } else {
                        w = Math.max(1, Math.round((w * maxSize) / h));
                        h = maxSize;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);

                const webpDataUrl = canvas.toDataURL('image/webp', quality);
                if (webpDataUrl && webpDataUrl.startsWith('data:image/webp')) {
                    return webpDataUrl;
                }
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (e) {
            console.warn('Compresión WebP omitida, usando original:', e);
        }

        return leerComoDataURL(file);
    }

    global.comprimirImagenWebP = comprimirImagenWebP;
})(window);

