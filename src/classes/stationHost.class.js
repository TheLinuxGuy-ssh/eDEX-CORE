const { BrowserView } = require("electron");
const { VscodeServer } = require("./vscodeServer.class.js");

const BROWSER_PLACEHOLDER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #000; color: #9fd; font-family: monospace; }
  body { display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; box-sizing: border-box; }
  h1 { margin: 0 0 12px; font-size: 13px; letter-spacing: 0.35em; font-weight: 600; color: #6cf; }
  p { margin: 0; max-width: 460px; line-height: 1.65; font-size: 12px; opacity: 0.72; }
  code { color: #6cf; }
</style>
</head>
<body>
  <div>
    <h1>PREVIEW STATION</h1>
    <p>Start a dev server in the terminal (e.g. <code>npm run dev</code>). When it prints a localhost URL, eDEX detects it and loads the preview here.</p>
    <p style="margin-top: 14px; opacity: 0.55;">Switch to TERM, start your server, then return to WEB — or click the PREVIEW badge when it appears.</p>
  </div>
</body>
</html>`;

class StationHost {
    constructor(win, appRoot, settings, shellEnv = null) {
        this.win = win;
        this.settings = settings;
        this.vscodeServer = new VscodeServer(appRoot, settings, shellEnv);
        this.view = null;
        this.currentUrl = null;
        this.visible = false;
        this._surface = null;
        this._lastBounds = null;
        this._forwardInput = false;
        this._bindWindowInputForwarding();
    }
    setInputForward(enabled) {
        this._forwardInput = !!enabled;
        if (enabled && this.visible && this.view) {
            this.focusEmbedded();
        }
    }
    focusEmbedded() {
        if (!this.view || !this.visible) return;
        if (typeof this.win.setTopBrowserView === "function") {
            this.win.setTopBrowserView(this.view);
        }
        if (!this.win.isFocused()) this.win.focus();
        this.view.webContents.focus();
    }
    _bindWindowInputForwarding() {
        if (this._inputForwardingBound || !this.win) return;
        this._inputForwardingBound = true;
        this.win.webContents.on("before-input-event", (event, input) => {
            if (!this._forwardInput || !this.visible || !this.view) return;
            if (input.type === "mouseDown" || input.type === "mouseUp" || input.type === "mouseMove"
                || input.type === "mouseWheel" || input.type === "contextMenu") {
                return;
            }
            this.focusEmbedded();
            this._sendInput(input);
            event.preventDefault();
        });
    }
    _electronKeyCode(data) {
        const named = {
            Enter: "Enter",
            Backspace: "Backspace",
            Tab: "Tab",
            Escape: "Escape",
            ArrowUp: "Up",
            ArrowDown: "Down",
            ArrowLeft: "Left",
            ArrowRight: "Right",
            Delete: "Delete",
            Home: "Home",
            End: "End",
            PageUp: "PageUp",
            PageDown: "PageDown",
            " ": "Space"
        };
        if (data.key && named[data.key]) return named[data.key];
        if (data.code && data.code.startsWith("Key")) return data.code.slice(3).toLowerCase();
        if (data.code && data.code.startsWith("Digit")) return data.code.slice(5);
        if (data.key && data.key.length === 1) return data.key;
        return data.key || "Unidentified";
    }
    _modifiersFrom(data) {
        const modifiers = [];
        if (data.ctrlKey || data.control) modifiers.push("control");
        if (data.shiftKey || data.shift) modifiers.push("shift");
        if (data.altKey || data.alt) modifiers.push("alt");
        if (data.metaKey || data.meta) modifiers.push("meta");
        return modifiers;
    }
    _sendInput(input) {
        if (!this.view || !this.visible) return;
        const wc = this.view.webContents;
        const modifiers = this._modifiersFrom(input);
        const keyCode = input.keyCode || this._electronKeyCode(input);

        if (input.type === "char" && input.key && input.key.length === 1) {
            wc.sendInputEvent({ type: "char", keyCode: input.key, modifiers });
            return;
        }

        if (input.type === "keyDown" || input.type === "rawKeyDown") {
            wc.sendInputEvent({ type: "rawKeyDown", keyCode, modifiers });
            if (input.key && input.key.length === 1 && !modifiers.includes("control") && !modifiers.includes("alt") && !modifiers.includes("meta")) {
                wc.sendInputEvent({ type: "char", keyCode: input.key, modifiers });
            }
            return;
        }

        if (input.type === "keyUp") {
            wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
        }
    }
    injectKeyboardEvent(data) {
        if (!this.view || !this.visible || !data) return;
        this.focusEmbedded();
        this._sendInput(data);
    }
    _resolveEditorZoom(bounds) {
        const manual = Number(this.settings.vscodeZoomFactor);
        if (Number.isFinite(manual) && manual > 0 && manual <= 3) {
            return manual;
        }

        const { screen } = require("electron");
        const display = screen.getDisplayMatching(this.win.getBounds());
        const dpr = display.scaleFactor || 1;
        let factor = 1.55;

        if (dpr >= 2) factor = 2;
        else if (dpr >= 1.5) factor = 1.8;
        else if (dpr >= 1.25) factor = 1.65;

        const h = bounds && bounds.height ? bounds.height : 0;
        const w = bounds && bounds.width ? bounds.width : 0;
        if (h > 0 && h < 720) factor += 0.15;
        if (w > 0 && w < 960) factor += 0.1;

        return Math.min(2.75, Math.round(factor * 100) / 100);
    }
    _applySurfaceZoom(bounds) {
        if (!this.view) return;
        const factor = this._surface === "editor"
            ? this._resolveEditorZoom(bounds || this._lastBounds)
            : 1;
        this.view.webContents.setZoomFactor(factor);
    }
    _ensureView() {
        if (this.view) return this.view;
        this.view = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: true,
                backgroundThrottling: false
            }
        });
        this.view.setBackgroundColor("#000000");
        this.view.webContents.setWindowOpenHandler(({ url }) => {
            require("electron").shell.openExternal(url);
            return { action: "deny" };
        });
        this.view.webContents.on("did-finish-load", () => {
            if (this._surface === "editor") {
                this._applySurfaceZoom(this._lastBounds);
            }
            if (this._forwardInput) this.focusEmbedded();
        });
        this.view.webContents.on("did-navigate", (e, url) => {
            this.currentUrl = url;
            if (this._surface === "editor") {
                this._applySurfaceZoom(this._lastBounds);
                if (this.win && !this.win.isDestroyed()) {
                    this.win.webContents.send("station-editor-navigate", url);
                }
            }
        });
        this.view.webContents.on("did-navigate-in-page", (e, url) => {
            this.currentUrl = url;
        });
        return this.view;
    }
    _attach(url, bounds, surface) {
        const view = this._ensureView();
        const previousSurface = this._surface;
        this._surface = surface || "browser";
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            this._lastBounds = bounds;
        }
        if (!this.visible) {
            this.win.addBrowserView(view);
            if (typeof this.win.setTopBrowserView === "function") {
                this.win.setTopBrowserView(view);
            }
            this.visible = true;
        }
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            this.setBounds(bounds);
        }
        if (url && (url !== this.currentUrl || previousSurface !== this._surface)) {
            view.webContents.loadURL(url);
            this.currentUrl = url;
        }
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            this.setBounds(bounds);
        } else {
            this._applySurfaceZoom(bounds);
        }
        if (this._surface === "editor" || this._surface === "browser") {
            this._forwardInput = true;
        }
        this.focusEmbedded();
        return view;
    }
    injectKey(payload) {
        if (!this.view || !this.visible) return;

        let cmd = "";
        let ctrl = false;
        let shift = false;
        let alt = false;

        if (typeof payload === "string") {
            cmd = payload;
        } else if (payload && typeof payload === "object") {
            cmd = payload.cmd || "";
            ctrl = !!payload.ctrl;
            shift = !!payload.shift;
            alt = !!payload.alt;
        }
        if (!cmd.length) return;

        this.focusEmbedded();
        const wc = this.view.webContents;
        const modifiers = [];
        if (ctrl) modifiers.push("control");
        if (shift) modifiers.push("shift");
        if (alt) modifiers.push("alt");

        const tap = (type, keyCode, extraMods = []) => {
            const mods = [...modifiers, ...extraMods];
            wc.sendInputEvent({ type, keyCode, modifiers: mods });
        };

        switch (cmd) {
            case "\r":
            case "\n":
                tap("rawKeyDown", "Enter");
                tap("keyUp", "Enter");
                return;
            case "\b":
                tap("rawKeyDown", "Backspace");
                tap("keyUp", "Backspace");
                return;
            case "\t":
                tap("rawKeyDown", "Tab");
                tap("keyUp", "Tab");
                return;
            case "\u001b":
                tap("rawKeyDown", "Escape");
                tap("keyUp", "Escape");
                return;
            case "\u001bOA":
                tap("rawKeyDown", "Up");
                tap("keyUp", "Up");
                return;
            case "\u001bOB":
                tap("rawKeyDown", "Down");
                tap("keyUp", "Down");
                return;
            case "\u001bOC":
                tap("rawKeyDown", "Right");
                tap("keyUp", "Right");
                return;
            case "\u001bOD":
                tap("rawKeyDown", "Left");
                tap("keyUp", "Left");
                return;
            case " ":
                wc.sendInputEvent({ type: "char", keyCode: " ", modifiers });
                return;
        }

        if (cmd.length === 1) {
            const code = cmd.charCodeAt(0);
            if (code >= 1 && code <= 26) {
                const letter = String.fromCharCode(code + 96);
                tap("rawKeyDown", letter, ["control"]);
                tap("keyUp", letter, ["control"]);
                return;
            }
            if (code >= 32 && code !== 127) {
                if (typeof wc.insertText === "function") {
                    wc.insertText(cmd);
                } else {
                    wc.sendInputEvent({ type: "char", keyCode: cmd, modifiers });
                }
                return;
            }
        }
    }
    hide() {
        if (this.view && this.visible) {
            this.win.removeBrowserView(this.view);
            this.visible = false;
            this._forwardInput = false;
        }
    }
    setBounds(bounds) {
        if (!this.view || !this.visible || !bounds) return;
        this._lastBounds = bounds;
        if (typeof this.win.setTopBrowserView === "function") {
            this.win.setTopBrowserView(this.view);
        }
        this.view.setBounds({
            x: Math.max(0, Math.round(bounds.x)),
            y: Math.max(0, Math.round(bounds.y)),
            width: Math.max(0, Math.round(bounds.width)),
            height: Math.max(0, Math.round(bounds.height))
        });
        this._applySurfaceZoom(bounds);
    }
    async showEditor(cwd, filePath, bounds) {
        const started = await this.vscodeServer.start(cwd);
        if (!started.ok) return started;
        const url = this.vscodeServer.buildWorkspaceUrl(cwd, filePath);
        this._attach(url, bounds, "editor");
        return { ok: true, url };
    }
    showBrowser(url, bounds) {
        if (!url) return { ok: false, error: "no-url" };
        if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
        this._attach(url, bounds, "browser");
        return { ok: true, url };
    }
    showPlaceholder(bounds) {
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(BROWSER_PLACEHOLDER_HTML)}`;
        this._attach(url, bounds, "browser");
        return { ok: true, url: "placeholder" };
    }
    probeDevServerUrl() {
        const http = require("http");
        const editorPort = String(this.settings.vscodePort || 9888);
        const ttyPort = String(this.settings.port || 3000);
        const ports = [
            5173, 5174, 5175, 5176, 5177,
            3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009,
            4000, 4001, 4002, 4003, 4004,
            4200, 4201,
            5000, 5001, 5002, 5003,
            8000, 8001, 8002, 8003,
            8080, 8081, 8082, 8083,
            8888, 8889,
            9000, 9001, 9002,
            9888
        ];

        const check = port => new Promise(resolve => {
            if (String(port) === editorPort) return resolve(null);
            const req = http.get({
                hostname: "127.0.0.1",
                port,
                path: "/",
                timeout: 1200
            }, res => {
                res.resume();
                if (res.statusCode && res.statusCode < 500) {
                    resolve(`http://127.0.0.1:${port}`);
                } else {
                    resolve(null);
                }
            });
            req.on("error", () => resolve(null));
            req.setTimeout(1200, () => {
                req.destroy();
                resolve(null);
            });
        });

        return ports.reduce((chain, port) => {
            return chain.then(found => {
                if (found) return found;
                if (String(port) === ttyPort) return null;
                return check(port);
            });
        }, Promise.resolve(null));
    }
    destroy() {
        this.hide();
        if (this.view) {
            this.view.webContents.destroy();
            this.view = null;
        }
        this.vscodeServer.stop();
    }
}

module.exports = { StationHost };
