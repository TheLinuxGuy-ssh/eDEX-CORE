class DevServerWatcher {
    constructor() {
        this._pattern = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d+)(?:[^\s\u001b"'<>]*)?/gi;
        this._hooked = new WeakSet();
    }
    watch(terminal) {
        if (!terminal || !terminal.socket || this._hooked.has(terminal.socket)) return;
        this._hooked.add(terminal.socket);
        terminal.socket.addEventListener("message", e => {
            if (typeof e.data === "string") this._scan(e.data);
        });
    }
    _scan(text) {
        const cleaned = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ");
        let match;
        const found = new Set();
        while ((match = this._pattern.exec(cleaned)) !== null) found.add(match[0]);
        if (!found.size || !window.session) return;
        const url = Array.from(found).pop();
        try {
            const parsed = new URL(url);
            const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
            const ttyPort = String(window.settings.port || 3000);
            const editorPort = String(window.settings.vscodePort || 9888);
            if (port === ttyPort || port === editorPort) return;
            window.session.setDevServer({ url: parsed.origin, port });
        } catch (e) {
            window.session.setDevServer({ url, port: null });
        }
    }
}

module.exports = { DevServerWatcher };
