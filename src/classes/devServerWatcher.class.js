class DevServerWatcher {
    constructor() {
        this._urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::(\d+))?(?:[^\s\u001b"'<>]*)?/gi;
        this._barePattern = /(?:^|[\s|>])(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d+)(?:[^\s\u001b"'<>]*)?/gi;
        this._hooked = new WeakSet();
    }
    watch(terminal) {
        if (!terminal || !terminal.socket || this._hooked.has(terminal.socket)) return;
        this._hooked.add(terminal.socket);
        terminal.socket.addEventListener("message", e => {
            if (typeof e.data === "string") this._scan(e.data);
        });
    }
    _normalizeUrl(raw) {
        if (!raw) return null;
        let url = raw.replace(/[)\]},;]+$/, "");
        if (!/^https?:\/\//i.test(url)) {
            url = `http://${url}`;
        }
        try {
            const parsed = new URL(url);
            if (!parsed.hostname) return null;
            if (!parsed.port && parsed.protocol === "http:") parsed.port = "80";
            if (!parsed.port && parsed.protocol === "https:") parsed.port = "443";
            return parsed;
        } catch (e) {
            return null;
        }
    }
    _acceptUrl(parsed) {
        if (!parsed || !window.session) return false;
        const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
        const editorPort = String(window.settings.vscodePort || 9888);
        if (port === editorPort) return false;
        const ttyPort = String(window.settings.port || 3000);
        if (port === ttyPort && parsed.pathname === "/") {
            return false;
        }
        return true;
    }
    _publish(parsed) {
        if (!this._acceptUrl(parsed)) return;
        window.session.setDevServer({
            url: parsed.origin,
            port: parsed.port
        });
    }
    _scan(text) {
        const cleaned = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ");
        const found = [];

        this._urlPattern.lastIndex = 0;
        let match;
        while ((match = this._urlPattern.exec(cleaned)) !== null) {
            found.push(match[0]);
        }

        this._barePattern.lastIndex = 0;
        while ((match = this._barePattern.exec(cleaned)) !== null) {
            found.push(match[0].trim());
        }

        if (!found.length) return;

        for (let i = found.length - 1; i >= 0; i--) {
            const parsed = this._normalizeUrl(found[i]);
            if (parsed && this._acceptUrl(parsed)) {
                this._publish(parsed);
                return;
            }
        }
    }
}

module.exports = { DevServerWatcher };
