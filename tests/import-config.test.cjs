/*  Run with: node --test tests/import-config.test.cjs
    Tests the real renderer methods and main-process configuration handlers.
    Electron, filesystem, timers, and Browser resources are inert fixtures.  */

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")
const jsYAML = require("js-yaml")

const sourceRoot = process.env.VINGESTER_SOURCE_ROOT || path.join(__dirname, "..")
const mainSource = fs.readFileSync(path.join(sourceRoot, "vingester-main.js"), "utf8")
const controlSource = fs.readFileSync(path.join(sourceRoot, "vingester-control.js"), "utf8")
const copy = (value) => JSON.parse(JSON.stringify(value))

function sourceBlock (source, start, end) {
    const first = source.indexOf(start)
    const last = source.indexOf(end, first)
    assert.ok(first >= 0 && last > first, "source block markers must exist")
    return source.slice(first, last)
}

function setup (options = {}) {
    const handlers = new Map()
    const calls = []
    const stops = []
    let stored
    let nextID = 0
    const dialog = options.dialog === undefined ? { canceled: true } : options.dialog
    const contents = options.contents === undefined ?
        "- BrowserTitle: Imported\n  InputURL: https://example.invalid/new\n" :
        options.contents
    const electron = {
        ipcMain: { handle (name, handler) { handlers.set(name, handler) } },
        ipcRenderer: {
            async invoke (name, ...args) {
                calls.push([ name, ...copy(args) ])
                return handlers.get(name)(null, ...copy(args))
            },
            on () {}
        },
        dialog: {
            async showOpenDialog () {
                if (dialog instanceof Error)
                    throw dialog
                return dialog
            },
            async showSaveDialog () { return { canceled: true } }
        }
    }
    class UUID {
        fold () { return [ ++nextID, 1 ] }
    }
    class Browser {
        constructor (log, id, cfg) {
            this.id = id
            this.cfg = cfg
            this.active = false
        }
        running () { return this.active }
        valid () { return true }
        async stop () {
            stops.push(this.id)
            this.active = false
        }
        reconfigure (cfg) { this.cfg = cfg }
    }
    const log = { info () {}, error () {}, scope () { return this } }
    const context = {
        electron, log, UUID, Browser, jsYAML,
        cfgDir: "/fixture",
        version: { vingester: "test" },
        moment: () => ({ format: () => "" }),
        store: {
            get: () => stored,
            set: (key, value) => {
                if (options.failSave && stored !== undefined)
                    throw new Error("fixture save failure")
                stored = value
            }
        },
        fs: {
            promises: {
                async readFile () {
                    if (options.failRead)
                        throw new Error("fixture read failure")
                    return contents
                },
                async writeFile () {}
            }
        },
        FFmpeg: { binary: "not-executed" },
        control: { webContents: { send () {} } }
    }
    vm.createContext(context)
    const config = sourceBlock(mainSource, "    const fields = [", "    /*  handle file selection  */")
    const controls = sourceBlock(mainSource, "    const browsers = {}", "    /*  show the window once the DOM was mounted  */")
    vm.runInContext(config + controls + "\nglobalThis.api = { sanitizeConfig, saveConfigs, loadConfigs, importConfig, browsers }", context)

    let component
    const app = { use () {}, component () {}, mount () {} }
    const modules = {
        electron,
        "throttle-debounce": { debounce: (delay, fn) => fn },
        "pure-uuid": UUID,
        "vue3-perfect-scrollbar": { default: {} },
        "vue-tippy": { default: {} },
        clone: copy,
        moment: context.moment,
        "./vingester-log.js": log
    }
    vm.runInNewContext(controlSource, {
        Vue: { createApp (options) { component = options; return app } },
        VueNextSelect: {},
        require (name) {
            assert.ok(Object.hasOwn(modules, name), `unexpected module: ${name}`)
            return modules[name]
        }
    }, { filename: "vingester-control.js" })
    const ui = component.data()
    for (const [ name, method ] of Object.entries(component.methods))
        ui[name] = method.bind(ui)
    ui.displays = [ { id: 1 } ]
    ui.renderDisplayIcons = () => {}
    const original = []
    const live = options.live === undefined ? 2 : options.live
    for (let index = 0; index < live + 1; index++) {
        const cfg = { id: `feed-${index}`, t: `Feed ${index}`, u: `https://example.invalid/${index}` }
        context.api.sanitizeConfig(cfg)
        original.push(cfg)
        const browser = new Browser(log, cfg.id, cfg)
        browser.active = index < live
        context.api.browsers[cfg.id] = browser
        ui.resetState(cfg.id)
        ui.running[cfg.id] = index < live
    }
    context.api.saveConfigs(original)
    ui.browsers = copy(original)
    return { ui, api: context.api, calls, stops, original, handlers, getStored: () => JSON.parse(stored) }
}

async function settle () {
    for (let index = 0; index < 30; index++)
        await Promise.resolve()
}

async function assertPreserved (options) {
    const state = setup(options)
    const runtime = { ...state.api.browsers }
    const configs = state.ui.browsers
    const running = copy(state.ui.running)
    await state.ui.importBrowsers()
    await settle()
    assert.deepEqual(state.stops, [], "a canceled or failed import must not stop feeds")
    assert.ok(!state.calls.some(([ name ]) => name === "browsers-load"), "a no-op import must not reload")
    assert.deepEqual(state.getStored(), state.original)
    assert.equal(state.ui.browsers, configs)
    assert.deepEqual(copy(state.ui.running), running)
    for (const id of Object.keys(runtime))
        assert.equal(state.api.browsers[id], runtime[id])
}

for (const live of [ 0, 1, 2, 5 ])
    test(`Cancel preserves ${live} running feeds and the stopped feed`, () => assertPreserved({ live }))

for (const [ name, options ] of [
    [ "rejected file dialog", { dialog: new Error("fixture dialog failure") } ],
    [ "empty selection", { dialog: { canceled: false, filePaths: [] } } ],
    [ "absent selection", { dialog: { canceled: false } } ],
    [ "multiple selections", { dialog: { canceled: false, filePaths: [ "/one", "/two" ] } } ],
    [ "malformed YAML", { contents: "[unterminated" } ],
    [ "unreadable file", { failRead: true } ],
    [ "failed persistence", { failSave: true } ]
]) {
    test(`${name} preserves all feeds and configuration`, () => assertPreserved({
        dialog: { canceled: false, filePaths: [ "/fixture/config.yaml" ] },
        ...options
    }))
}

test("the main handler returns false for malformed YAML", async () => {
    const state = setup({ dialog: { canceled: false, filePaths: [ "/fixture/config.yaml" ] }, contents: "[unterminated" })
    assert.equal(await state.handlers.get("browsers-import")(null), false)
    assert.deepEqual(state.stops, [])
    assert.deepEqual(state.getStored(), state.original)
})

test("a successful import returns true only after saving", async () => {
    const state = setup()
    assert.equal(await state.api.importConfig("/fixture/config.yaml"), true)
    assert.equal(state.getStored()[0].t, "Imported")
    assert.equal(state.getStored()[0].u, "https://example.invalid/new")
    assert.deepEqual(state.stops, [])
})

test("successful replacement still stops old feeds and loads imported configuration", async () => {
    const state = setup({ dialog: { canceled: false, filePaths: [ "/fixture/config.yaml" ] } })
    await state.ui.importBrowsers()
    await settle()
    assert.equal(state.stops.length, 2)
    assert.equal(state.ui.browsers.length, 1)
    assert.equal(state.ui.browsers[0].t, "Imported")
    assert.equal(state.ui.browsers[0].u, "https://example.invalid/new")
    assert.equal(Object.keys(state.api.browsers).length, 1)
})

test("an explicit empty list remains a successful replacement", async () => {
    const state = setup({ dialog: { canceled: false, filePaths: [ "/fixture/config.yaml" ] }, contents: "[]" })
    await state.ui.importBrowsers()
    await settle()
    assert.equal(state.stops.length, 2)
    assert.equal(state.ui.browsers.length, 0)
    assert.deepEqual(state.getStored(), [])
})

for (const result of [ undefined, false, 1, "true", {} ]) {
    test(`only literal success reloads: ${String(result)}`, async () => {
        const state = setup()
        state.handlers.set("browsers-import", async () => result)
        let loads = 0
        state.ui.load = async () => { loads++ }
        await state.ui.importBrowsers()
        assert.equal(loads, 0)
    })
}

test("successful import awaits the renderer reload", async () => {
    const state = setup()
    state.handlers.set("browsers-import", async () => true)
    let release
    let finished = false
    state.ui.load = () => new Promise((resolve) => { release = resolve })
    const pending = state.ui.importBrowsers().then(() => { finished = true })
    await settle()
    assert.equal(typeof release, "function")
    assert.equal(finished, false)
    release()
    await pending
    assert.equal(finished, true)
})
