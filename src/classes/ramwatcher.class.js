class RAMwatcher {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Create DOM - reduced from 440 to 110 points (75% fewer DOM nodes)
        this.parent = document.getElementById(parentId);
        let modExtContainer = document.createElement("div");
        const POINT_COUNT = 110;
        let ramwatcherDOM = `<div id="mod_ramwatcher_inner">
                <h1>MEMORY<i id="mod_ramwatcher_info"></i></h1>
                <div id="mod_ramwatcher_pointmap">`;

        for (var i = 0; i < POINT_COUNT; i++) {
            ramwatcherDOM += `<div class="mod_ramwatcher_point free"></div>`;
        }

        ramwatcherDOM += `</div>
                <div id="mod_ramwatcher_swapcontainer">
                    <h1>SWAP</h1>
                    <progress id="mod_ramwatcher_swapbar" max="100" value="0"></progress>
                    <h3 id="mod_ramwatcher_swaptext">0.0 GiB</h3>
                </div>
        </div>`;

        modExtContainer.innerHTML = ramwatcherDOM;
        modExtContainer.setAttribute("id", "mod_ramwatcher");
        this.parent.append(modExtContainer);

        this.points = Array.from(document.querySelectorAll("div.mod_ramwatcher_point"));
        this.shuffleArray(this.points);
        this.lastActive = -1;
        this.lastAvailable = -1;
        this.POINT_COUNT = POINT_COUNT;

        // Init updaters
        this.currentlyUpdating = false;
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 15000);
    }
    updateInfo() {
        if (this.currentlyUpdating) return;
        this.currentlyUpdating = true;
        window.si.mem().then(data => {
            if (data.free+data.used !== data.total) throw("RAM Watcher Error: Bad memory values");

            // Convert the data for the 110-points grid
            let active = Math.round((this.POINT_COUNT*data.active)/data.total);
            let available = Math.round((this.POINT_COUNT*(data.available-data.free))/data.total);

            // Only update grid if values changed
            if (active !== this.lastActive || available !== this.lastAvailable) {
                // Update grid
                this.points.slice(0, active).forEach(domPoint => {
                    if (domPoint.attributes.class.value !== "mod_ramwatcher_point active") {
                        domPoint.setAttribute("class", "mod_ramwatcher_point active");
                    }
                });
                this.points.slice(active, active+available).forEach(domPoint => {
                    if (domPoint.attributes.class.value !== "mod_ramwatcher_point available") {
                        domPoint.setAttribute("class", "mod_ramwatcher_point available");
                    }
                });
                this.points.slice(active+available, this.points.length).forEach(domPoint => {
                    if (domPoint.attributes.class.value !== "mod_ramwatcher_point free") {
                        domPoint.setAttribute("class", "mod_ramwatcher_point free");
                    }
                });
                this.lastActive = active;
                this.lastAvailable = available;
            }

            // Update info text
            let totalGiB = Math.round((data.total/1073742000)*10)/10; // 1073742000 bytes = 1 Gibibyte (GiB), the *10 is to round to .1 decimal
            let usedGiB = Math.round((data.active/1073742000)*10)/10;
            document.getElementById("mod_ramwatcher_info").innerText = `USING ${usedGiB} OUT OF ${totalGiB} GiB`;

            // Update swap indicator
            let usedSwap = Math.round((100*data.swapused)/data.swaptotal);
            document.getElementById("mod_ramwatcher_swapbar").value = usedSwap || 0;

            let usedSwapGiB = Math.round((data.swapused/1073742000)*10)/10;
            document.getElementById("mod_ramwatcher_swaptext").innerText = `${usedSwapGiB} GiB`;

            this.currentlyUpdating = false;
        });
    }
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
    destroy() {
        if (this.infoUpdater) {
            clearInterval(this.infoUpdater);
            this.infoUpdater = null;
        }
        this.points = null;
        const el = document.getElementById("mod_ramwatcher");
        if (el) el.remove();
    }
}

module.exports = {
    RAMwatcher
};
