import settings from '../settings.js';
import prismarineViewer from 'prismarine-viewer';
const mineflayerViewer = prismarineViewer.mineflayer;

let viewerErrorHandlerInstalled = false;

function installViewerErrorHandler() {
    if (viewerErrorHandlerInstalled) return;
    viewerErrorHandlerInstalled = true;

    const handleViewerError = (err) => {
        const stack = String(err?.stack || err || '');
        if (stack.includes('prismarine-viewer') || stack.includes('viewer\\lib\\entity\\Entity.js')) {
            console.warn('[viewer] Ignored prismarine-viewer render error:', err?.message || err);
            return true;
        }

        return false;
    };

    process.on('uncaughtException', (err) => {
        if (handleViewerError(err)) return;
        throw err;
    });

    process.on('unhandledRejection', (err) => {
        if (handleViewerError(err)) return;
        throw err;
    });
}

export function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view !== true) return;

    installViewerErrorHandler();

    try {
        mineflayerViewer(bot, { port: 3000 + count_id, firstPerson: true });
    } catch (err) {
        console.warn('[viewer] Failed to start prismarine-viewer:', err?.message || err);
    }
}
