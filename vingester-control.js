/*
**  Vingester ~ Ingest Web Contents as Video Streams
**  Copyright (c) 2021 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under GPL 3.0 <https://spdx.org/licenses/GPL-3.0-only>
*/

const electron    = require("electron")
const electronLog = require("electron-log")
const debounce    = require("throttle-debounce").debounce
const UUID        = require("pure-uuid")

/*  etablish reasonable logging environment  */
if (typeof process.env.DEBUG !== "undefined") {
    electronLog.transports.file.level    = "debug"
    electronLog.transports.console.level = "debug"
    electronLog.transports.ipc.level     = "debug"
}
else {
    electronLog.transports.file.level    = "info"
    electronLog.transports.console.level = false
    electronLog.transports.ipc.level     = false
}
electronLog.transports.remote.level   = false
electronLog.transports.console.format = "{h}:{i}:{s}.{ms} > [{level}] {scope} {text}"
electronLog.transports.file.format    = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}"
const log = electronLog.scope("UI")
log.info("starting up")

Vue.createApp({
    data () {
        return {
            browsers: [],
            running:  {},
            stat:     {},
            burst:    {},
            trace:    {},
            usage:    0,
            gpu:      false,
            info:     false,
            version:  {}
        }
    },
    computed: {
        nAvailable () {
            return Object.keys(this.browsers).length
        },
        nRunning () {
            return Object.keys(this.running)
                .map((id) => this.running[id] ? 1 : 0)
                .reduce((acc, val) => acc + val, 0)
        }
    },
    async created () {
        log.info("creating")
        this.load()
        electron.ipcRenderer.on("browser-start", (ev, id) => {
            log.info("browser-start", id)
        })
        electron.ipcRenderer.on("browser-started", (ev, id) => {
            log.info("browser-started", id)
            this.running[id] = true
        })
        electron.ipcRenderer.on("browser-reload", (ev, id) => {
            log.info("browser-reload", id)
        })
        electron.ipcRenderer.on("browser-reloaded", (ev, id) => {
            log.info("browser-reloaded", id)
        })
        electron.ipcRenderer.on("browser-stop", (ev, id) => {
            log.info("browser-stop", id)
        })
        electron.ipcRenderer.on("browser-stopped", (ev, id) => {
            log.info("browser-stopped", id)
            this.running[id] = false
        })
        electron.ipcRenderer.on("stat", (ev, stat) => {
            this.stat[stat.id] = stat
        })
        electron.ipcRenderer.on("trace", (ev, trace) => {
            if (trace.level === 2)
                this.trace[trace.id].warning++
            else if (trace.level === 3)
                this.trace[trace.id].error++
            let level = "UNKNOWN"
            switch (trace.level) {
                case 0: level = "DEBUG";   break
                case 1: level = "INFO";    break
                case 2: level = "WARNING"; break
                case 3: level = "ERROR";   break
            }
            if (this.trace[trace.id].messages.length > 20)
                this.trace[trace.id].messages.shift()
            this.trace[trace.id].messages.push({ level, message: trace.message })
            this.$nextTick(() => {
                const console = this.$refs[`console-${trace.id}`]
                console.scrollTop = console.scrollHeight
            })
        })
        electron.ipcRenderer.on("usage", (ev, usage) => {
            this.usage = usage
        })
        electron.ipcRenderer.on("burst", (ev, stat) => {
            this.burst[stat.id] = stat
        })
        electron.ipcRenderer.on("capture", async (ev, capture) => {
            const canvas = this.$refs[`canvas-${capture.id}`]
            const ctx = canvas.getContext("2d")
            const arr    = new Uint8ClampedArray(capture.buffer)
            const pixels = new ImageData(arr, capture.size.width, capture.size.height)
            const bitmap = await createImageBitmap(pixels)
            ctx.drawImage(bitmap, 0, 0)
        })
        electron.ipcRenderer.on("gpu", (ev, gpu) => {
            this.gpu = gpu
        })
        this.version = await electron.ipcRenderer.invoke("version")
        log.info("created")
        electron.ipcRenderer.invoke("control-created")
    },
    methods: {
        async load () {
            let browsers = await electron.ipcRenderer.invoke("browsers-load")
            if (browsers === undefined)
                browsers = "[]"
            const B = JSON.parse(browsers)
            for (const browser of B) {
                await electron.ipcRenderer.invoke("control", "add", browser.id, JSON.stringify(browser))
                this.running[browser.id] = false
                this.stat[browser.id] = { fps: 0, memUsed: 0, memAvail: 0 }
                this.burst[browser.id] = { avg: 0, min: 0, max: 0, tmin: 0, tmax: 0 }
                this.trace[browser.id] = { visible: false, warning: 0, error: 0, messages: [] }
            }
            this.browsers = B
        },
        save: debounce(1000, async function () {
            const browsers = JSON.stringify(this.browsers)
            await electron.ipcRenderer.invoke("browsers-save", browsers)
        }),
        async exportBrowsers () {
            await electron.ipcRenderer.invoke("browsers-export")
        },
        async importBrowsers () {
            if (await electron.ipcRenderer.invoke("browsers-import"))
                this.load()
        },
        async addBrowser () {
            const id = new UUID(1).format("std")
            const browser = {
                id,
                t: "Sample", w: "1280", h: "720", c: "#00ff00",
                u: "",
                D: true, d: "", x: "0", y: "0", p: false,
                N: false, f: "30",
                P: false
            }
            this.running[id] = false
            this.stat[id] = { fps: 0, memUsed: 0, memAvail: 0 }
            this.burst[browser.id] = { avg: 0, min: 0, max: 0, tmin: 0, tmax: 0 }
            this.trace[browser.id] = { visible: false, warning: 0, error: 0, messages: [] }
            this.browsers.push(browser)
            this.save()
            await electron.ipcRenderer.invoke("control", "add", browser.id, JSON.stringify(browser))
        },
        async modBrowser (browser) {
            await electron.ipcRenderer.invoke("control", "mod", browser.id, JSON.stringify(browser))
        },
        async delBrowser (browser) {
            if (this.running[browser.id])
                return
            this.browsers = this.browsers.filter((b) => b.id !== browser.id)
            delete this.running[browser.id]
            delete this.stat[browser.id]
            delete this.burst[browser.id]
            delete this.trace[browser.id]
            this.save()
            await electron.ipcRenderer.invoke("control", "del", browser.id)
        },
        async control (action, id) {
            const browser = this.browsers.find((b) => b.id === id)
            if (   (action === "start-all"  && (this.nAvailable === 0 || this.nAvailable === this.nRunning) || browser.u === '')
                || (action === "reload-all" && this.nRunning === 0)
                || (action === "stop-all"   && this.nRunning === 0))
                return
            if (   (action === "start"  &&  this.running[id])
                || (action === "reload" && !this.running[id])
                || (action === "stop"   && !this.running[id]))
                return
            if (action === "start" && browser !== undefined && !browser.D && !browser.N)
                return
            await electron.ipcRenderer.invoke("control", action, id)
        },
        toggle (browser, field, options) {
            if (field !== "P" && this.running[browser.id])
                return
            const val = browser[field]
            let i = 0
            while (i < options.length)
                if (options[i++] === val)
                    break
            if (i === options.length)
                i = 0
            browser[field] = options[i]
            this.changed(browser)
        },
        changed (browser) {
            this.modBrowser(browser)
            this.save()
        },
        toggleGPU () {
            electron.ipcRenderer.invoke("gpu", !this.gpu)
        }
    }
}).mount("body")

