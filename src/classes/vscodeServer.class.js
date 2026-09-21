const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const os = require("os");

class VscodeServer {
    constructor(appRoot, settings, shellEnv = null) {
        this.appRoot = appRoot;
        this.settings = settings;
        this.shellEnv = shellEnv;
        this.process = null;
        this.port = settings.vscodePort || 9888;
        this.baseUrl = null;
        this.ready = false;
        this.userDataDir = null;
        this.serverDataDir = null;
        this._spawnEnv = this._buildSpawnEnv();
    }
    _resolveBinary() {
        const candidates = [];
        if (this.settings.openvscodeServerPath) candidates.push(this.settings.openvscodeServerPath);
        candidates.push(path.join(this.appRoot, "vendor", "openvscode-server", "bin", "openvscode-server"));
        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) return candidate;
        }
        return null;
    }
    _buildSpawnEnv() {
        const base = { ...(this.shellEnv || {}), ...process.env };
        const home = path.resolve(base.HOME || os.homedir());
        base.HOME = home;
        base.USER = base.USER || os.userInfo().username;
        base.LOGNAME = base.LOGNAME || base.USER;
        base.LANG = base.LANG || "en_US.UTF-8";

        const xdgDirs = {
            XDG_DOCUMENTS_DIR: "Documents",
            XDG_DOWNLOAD_DIR: "Downloads",
            XDG_DESKTOP_DIR: "Desktop"
        };
        Object.keys(xdgDirs).forEach(key => {
            if (base[key]) return;
            const candidate = path.join(home, xdgDirs[key]);
            if (fs.existsSync(candidate)) base[key] = candidate;
        });

        return base;
    }
    _resolveHome() {
        return path.resolve(this._spawnEnv.HOME || os.homedir());
    }
    _resolveWorkspacePath(cwd) {
        let target = cwd || this.settings.cwd || this._resolveHome();
        if (typeof target !== "string" || !target.trim()) target = this._resolveHome();
        if (target.startsWith("FALLBACK |-- ")) target = target.slice(13);
        target = path.resolve(target);
        if (fs.existsSync(target)) return target;

        const fallback = path.resolve(this.settings.cwd || this._resolveHome());
        if (fs.existsSync(fallback)) return fallback;
        return this._resolveHome();
    }
    _ensureDataDirs() {
        const { app } = require("electron");
        this.userDataDir = path.join(app.getPath("userData"), "openvscode-server");
        this.serverDataDir = path.join(app.getPath("userData"), "openvscode-server-data");
        fs.mkdirSync(path.join(this.userDataDir, "User"), { recursive: true });
        fs.mkdirSync(path.join(this.userDataDir, "Machine"), { recursive: true });
        fs.mkdirSync(this.serverDataDir, { recursive: true });

        const machineSettingsPath = path.join(this.userDataDir, "Machine", "settings.json");
        let machineSettings = {};
        if (fs.existsSync(machineSettingsPath)) {
            try {
                machineSettings = JSON.parse(fs.readFileSync(machineSettingsPath, "utf8"));
            } catch (e) {}
        }
        Object.assign(machineSettings, {
            "security.workspace.trust.enabled": false,
            "security.workspace.trust.untrustedFiles": "open",
            "security.workspace.trust.emptyWindow": false,
            "files.simpleDialog.enabled": false
        });
        fs.writeFileSync(machineSettingsPath, JSON.stringify(machineSettings, null, 4));
    }
    _waitForHttp(url, attempts = 50, delayMs = 250) {
        return new Promise((resolve, reject) => {
            let tries = 0;
            const tick = () => {
                tries += 1;
                http.get(url, res => {
                    res.resume();
                    resolve(true);
                }).on("error", () => {
                    if (tries >= attempts) reject(new Error("Editor core failed to start."));
                    else setTimeout(tick, delayMs);
                });
            };
            tick();
        });
    }
    async start(cwd) {
        if (this.ready && this.baseUrl) return { ok: true, baseUrl: this.baseUrl };

        const binary = this._resolveBinary();
        if (!binary) {
            return { ok: false, error: "missing", setupPath: path.join(this.appRoot, "vendor", "openvscode-server") };
        }

        this.port = this.settings.vscodePort || 9888;
        this.baseUrl = `http://127.0.0.1:${this.port}/`;
        this._ensureDataDirs();

        const home = this._resolveHome();
        const workspace = this._resolveWorkspacePath(cwd);

        this.process = spawn(binary, [
            "--host", "127.0.0.1",
            "--port", String(this.port),
            "--without-connection-token",
            "--accept-server-license-terms",
            "--disable-workspace-trust",
            "--telemetry-level", "off",
            "--user-data-dir", this.userDataDir,
            "--server-data-dir", this.serverDataDir,
            "--default-folder", workspace
        ], {
            cwd: home,
            env: this._spawnEnv,
            stdio: "ignore"
        });

        this.process.on("exit", () => {
            this.process = null;
            this.ready = false;
            this.baseUrl = null;
        });

        await this._waitForHttp(this.baseUrl);
        this.ready = true;
        return { ok: true, baseUrl: this.baseUrl, workspace };
    }
    buildWorkspaceUrl(cwd, filePath) {
        if (!this.baseUrl) return null;
        const workspace = this._resolveWorkspacePath(cwd);
        let url = `${this.baseUrl}?folder=${encodeURIComponent(workspace)}`;
        if (filePath) {
            let file = filePath;
            if (file.startsWith("FALLBACK |-- ")) file = file.slice(13);
            url += `&file=${encodeURIComponent(path.resolve(file))}`;
        }
        return url;
    }
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.ready = false;
        this.baseUrl = null;
    }
}

module.exports = { VscodeServer };
