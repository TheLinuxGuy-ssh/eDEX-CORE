class Session {
    constructor() {
        this.cwd = Session.normalizePath(window.settings.cwd || "");
        this.openFile = null;
        this.devServer = null;
        this.station = "terminal";
        this.hyperfocus = false;
        this._listeners = {};
    }
    static normalizePath(cwd) {
        if (!cwd || typeof cwd !== "string") return "";
        if (cwd.startsWith("FALLBACK |-- ")) cwd = cwd.slice(13);
        try {
            return require("path").resolve(cwd);
        } catch (e) {
            return cwd;
        }
    }
    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }
    emit(event, payload) {
        (this._listeners[event] || []).forEach(fn => fn(payload));
    }
    setCwd(cwd) {
        if (!cwd || cwd === this.cwd) return;
        if (cwd.startsWith("FALLBACK |-- ")) cwd = cwd.slice(13);
        cwd = Session.normalizePath(cwd);
        if (!cwd || cwd === this.cwd) return;
        this.cwd = cwd;
        this.emit("cwd", cwd);
    }
    setOpenFile(filePath) {
        this.openFile = filePath;
        this.emit("openFile", filePath);
    }
    setDevServer(info) {
        this.devServer = info;
        this.emit("devServer", info);
        const badge = document.getElementById("station_dev_badge");
        if (badge) {
            badge.innerText = info && info.url ? `PREVIEW ${info.url}` : "";
            badge.style.display = info && info.url ? "inline-block" : "none";
        }
    }
    setStation(name) {
        if (this.station === name) return;
        this.station = name;
        this.emit("station", name);
    }
    setHyperfocus(state) {
        if (this.hyperfocus === state) return;
        this.hyperfocus = state;
        this.emit("hyperfocus", state);
    }
}

module.exports = { Session };
