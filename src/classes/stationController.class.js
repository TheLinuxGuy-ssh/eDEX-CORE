class StationController {
    static get WORKSPACES() {
        return ["terminal", "editor", "browser"];
    }
    static get HYPERFOCUS_MS() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 680;
    }
    static get CHROME_MS() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 320;
    }
    constructor() {
        this.ipc = require("electron").ipcRenderer;
        this.session = window.session;
        this._busy = false;
        this._bindUi();
        this._bindResize();
        this.setStation("terminal", { silent: true });
    }
    _bindUi() {
        document.querySelectorAll("#main_shell_stations > li[data-station]").forEach(el => {
            el.onclick = () => {
                window.audioManager.panels.play();
                this.setStation(el.getAttribute("data-station"));
            };
        });
        const badge = document.getElementById("station_dev_badge");
        if (badge) {
            badge.onclick = () => {
                if (this.session.devServer && this.session.devServer.url) {
                    this.setStation("browser");
                }
            };
        }
    }
    _bindResize() {
        const stage = document.getElementById("station_stage");
        if (stage && typeof ResizeObserver !== "undefined") {
            this._boundsObserver = new ResizeObserver(() => {
                if (this.session.station === "terminal") {
                    this._fitTerminal();
                    return;
                }
                clearTimeout(this._boundsDebounce);
                this._boundsDebounce = setTimeout(() => this._syncBounds(), 48);
            });
            this._boundsObserver.observe(stage);
        }

        window.addEventListener("resize", () => {
            if (this.session.station !== "terminal") this._syncBounds();
        });

        this.session.on("hyperfocus", () => {
            if (this.session.station !== "terminal") this._syncBoundsDuring(StationController.HYPERFOCUS_MS);
        });

        this.session.on("devServer", info => {
            if (!info || !info.url) return;
            if (this.session.station === "browser") {
                this._showBrowserSurface(info.url);
            }
        });

        require("@electron/remote").getCurrentWindow().on("resize", () => {
            if (this.session.station !== "terminal") this._syncBounds();
        });
    }
    _getBounds() {
        const el = document.getElementById("main_shell_innercontainer")
            || document.getElementById("station_stage");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return null;
        return {
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height
        };
    }
    _afterLayout(fn) {
        requestAnimationFrame(() => requestAnimationFrame(fn));
    }
    _scheduleBoundsSync() {
        this._syncBounds();
        this._afterLayout(() => this._syncBounds());
        clearTimeout(this._chromeBoundsTimer);
        this._chromeBoundsTimer = setTimeout(() => this._syncBounds(), StationController.CHROME_MS + 24);
    }
    _showBrowserSurface(url) {
        this._afterLayout(() => {
            const attach = () => {
                const bounds = this._getBounds();
                if (!bounds) {
                    requestAnimationFrame(attach);
                    return;
                }
                if (url) {
                    this.ipc.send("station-show-browser", url, bounds);
                } else {
                    this.ipc.send("station-show-placeholder", bounds);
                }
                this._scheduleBoundsSync();
            };
            attach();
        });
    }
    _syncBounds() {
        if (this.session.station === "terminal") return;
        const bounds = this._getBounds();
        if (bounds) this.ipc.send("station-set-bounds", bounds);
    }
    _syncBoundsDuring(durationMs) {
        if (this.session.station === "terminal") return;
        const start = performance.now();
        const tick = () => {
            this._syncBounds();
            if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
    _updateChrome(station) {
        document.body.classList.remove("station-terminal", "station-editor", "station-browser");
        document.body.classList.add(`station-${station}`);
        document.querySelectorAll("#main_shell_stations > li[data-station]").forEach(el => {
            el.classList.toggle("active", el.getAttribute("data-station") === station);
        });
    }
    _setKeyboardMode(station) {
        if (!window.keyboard) return;
        if (station === "terminal") {
            window.keyboard.attach();
        } else {
            window.keyboard.linkToStation();
        }
    }
    _fitTerminal() {
        if (typeof window.currentTerm === "undefined") return;
        const term = window.term[window.currentTerm];
        if (term && term.fit) term.fit();
    }
    _fitTerminalDuring(durationMs) {
        if (this.session.station !== "terminal") return;
        const start = performance.now();
        const tick = () => {
            this._fitTerminal();
            if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
    _beginHyperfocusAnimation() {
        document.body.classList.add("hyperfocus-animating");
        clearTimeout(this._hyperfocusAnimTimer);
        this._hyperfocusAnimTimer = setTimeout(() => {
            document.body.classList.remove("hyperfocus-animating");
            this._syncBounds();
            this._fitTerminal();
        }, StationController.HYPERFOCUS_MS + 40);
    }
    _finishEmbedded(station, options = {}) {
        if (options.silent !== true) this.session.setStation(station);
        this._setKeyboardMode(station);
        if (station === "terminal") {
            this._fitTerminal();
            setTimeout(() => this._fitTerminal(), 80);
        } else {
            this._scheduleBoundsSync();
            this.ipc.send("station-focus-embedded");
        }
        this._busy = false;
    }
    setStation(station, options = {}) {
        if (this._busy || !station) return;
        if (!options.silent && station === this.session.station) return;

        if (options.silent) {
            this._updateChrome(station);
            this.session.setStation(station);
            this._setKeyboardMode(station);
            if (station !== "terminal") this._scheduleBoundsSync();
            return;
        }

        this._busy = true;
        if (window.audioManager && window.audioManager.panels) window.audioManager.panels.play();
        this._updateChrome(station);

        if (station === "terminal") {
            this.ipc.send("station-hide");
            this._finishEmbedded(station, options);
            return;
        }

        if (station === "editor") {
            const overlay = document.getElementById("station_loading_overlay");
            if (overlay) overlay.classList.add("visible");
            this._afterLayout(() => {
                const show = () => {
                    const bounds = this._getBounds();
                    if (!bounds) {
                        requestAnimationFrame(show);
                        return;
                    }
                    this.ipc.send("station-show-editor", this.session.cwd, this.session.openFile, bounds);
                };
                show();
            });
            this.ipc.once("station-show-editor-reply", (e, result) => {
                if (overlay) overlay.classList.remove("visible");
                if (!result || !result.ok) {
                    new Modal({
                        type: "info",
                        title: "Editor core offline",
                        html: `Run <strong>npm run setup:vscode</strong> once, then restart eDEX-CORE.<br><br>${result && result.setupPath ? result.setupPath : ""}`
                    });
                    this._updateChrome("terminal");
                    this.ipc.send("station-hide");
                    this.session.setStation("terminal");
                    this._setKeyboardMode("terminal");
                    this._busy = false;
                    return;
                }
                this._finishEmbedded(station, options);
            });
            return;
        }

        if (station === "browser") {
            const openBrowser = url => {
                this._showBrowserSurface(url);
            };
            const finishBrowser = (e, result) => {
                if (!result || !result.ok) {
                    this._updateChrome("terminal");
                    this.ipc.send("station-hide");
                    this.session.setStation("terminal");
                    this._setKeyboardMode("terminal");
                    this._busy = false;
                    return;
                }
                this._finishEmbedded(station, options);
            };
            this.ipc.once("station-show-browser-reply", finishBrowser);

            const known = this.session.devServer && this.session.devServer.url;
            if (known) {
                openBrowser(known);
                return;
            }

            this.ipc.once("station-probe-dev-server-reply", (e, found) => {
                if (found) {
                    try {
                        const parsed = new URL(found);
                        this.session.setDevServer({ url: parsed.origin, port: parsed.port });
                    } catch (err) {
                        this.session.setDevServer({ url: found, port: null });
                    }
                    openBrowser(found);
                } else {
                    openBrowser(null);
                }
            });
            this.ipc.send("station-probe-dev-server");
        }
    }
    toggleHyperfocus() {
        this._beginHyperfocusAnimation();
        this.session.setHyperfocus(!this.session.hyperfocus);
        document.body.classList.toggle("mode-hyperfocus", this.session.hyperfocus);
        window.audioManager.panels.play();
        if (this.session.station !== "terminal") this._syncBoundsDuring(StationController.HYPERFOCUS_MS);
        this._fitTerminalDuring(StationController.HYPERFOCUS_MS);
        if (typeof window.registerKeyboardShortcuts === "function") {
            window.registerKeyboardShortcuts();
        }
    }
    openEditorFile(filePath) {
        this.session.setOpenFile(filePath);
        this.setStation("editor");
    }
    cycleWorkspace(delta) {
        const order = StationController.WORKSPACES;
        let i = order.indexOf(this.session.station);
        if (i < 0) i = 0;
        i = (i + delta + order.length) % order.length;
        this.setStation(order[i]);
    }
}

module.exports = { StationController };
