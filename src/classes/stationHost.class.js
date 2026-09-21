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
</style>
</head>
<body>
  <div>
    <h1>PREVIEW STATION</h1>
    <p>Start a dev server in the terminal. When it prints a localhost URL, eDEX will detect it and load the preview here automatically.</p>
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
                webSecurity: true
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
        if (url && url !== this.currentUrl) {
            view.webContents.loadURL(url);
            this.currentUrl = url;
        }
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            this.setBounds(bounds);
        } else {
            this._applySurfaceZoom(bounds);
        }
        view.webContents.focus();
        return view;
    }
    injectKey(cmd) {
        if (!this.view || !this.visible || typeof cmd !== "string" || !cmd.length) return;
        const wc = this.view.webContents;
        const sendKey = keyCode => {
            wc.sendInputEvent({ type: "keyDown", keyCode });
            wc.sendInputEvent({ type: "keyUp", keyCode });
        };
        if (cmd.length === 1) {
            const code = cmd.charCodeAt(0);
            if (code >= 32 && code !== 127) {
                wc.sendInputEvent({ type: "char", keyCode: cmd });
                return;
            }
        }
        switch (cmd) {
            case "\r":
            case "\n":
                sendKey("Enter");
                break;
            case "\b":
                sendKey("Backspace");
                break;
            case "\t":
                sendKey("Tab");
                break;
            case "\u001b":
                sendKey("Escape");
                break;
            case "\u001bOA":
                sendKey("Up");
                break;
            case "\u001bOB":
                sendKey("Down");
                break;
            case "\u001bOC":
                sendKey("Right");
                break;
            case "\u001bOD":
                sendKey("Left");
                break;
            case " ":
                wc.sendInputEvent({ type: "char", keyCode: " " });
                break;
            default:
                if (cmd.length === 1) wc.sendInputEvent({ type: "char", keyCode: cmd });
        }
    }
    hide() {
        if (this.view && this.visible) {
            this.win.removeBrowserView(this.view);
            this.visible = false;
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
