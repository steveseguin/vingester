/*  Offline packaging exit-status regression. No build, signing or media runs.  */
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { spawnSync } = require("node:child_process")

if (process.argv[2] === "--fixture") {
    const [ sourcePath, platform, failure ] = process.argv.slice(3)
    const calls = []
    const step = (name, args = []) => {
        calls.push({ name, args })
        if (name === failure)
            throw new Error(`fixture failure: ${name}`)
    }
    const shellStep = (name, args) => {
        step(name, args)
        return { code: failure === `${name}-returned` ? 1 : 0, stderr: `fixture returned failure: ${name}` }
    }
    const modules = {
        os: { platform: () => platform, arch: () => "x64", homedir: () => "/fixture-home" },
        fs: {
            promises: {
                readFile: async (file) => {
                    const name = file.endsWith(".zip") ? "read-archive" :
                        file.endsWith(".prv") ? "read-private-key" : "read-public-key"
                    step(name, [ file ])
                    return "synthetic fixture bytes"
                },
                writeFile: async (...args) => { step("write-signature", args) }
            }
        },
        path,
        glob: {
            sync: (pattern) => {
                step("glob", [ pattern ])
                return [ "SourceSansPro", "SourceCodePro", "Overlock", "Unused" ]
                    .map((font) => `node_modules/typopro-web/web/TypoPRO-${font}`)
            }
        },
        shelljs: {
            rm: (...args) => shellStep(args[1] === "dist" ? "cleanup" : "remove-font", args),
            mv: (...args) => shellStep("move", args)
        },
        execa: { sync: (...args) => { step("build", args) } },
        "cross-zip": { zipSync: (...args) => { step("zip", args) } },
        dsig: {
            sign: async (...args) => { step("sign", args); return "synthetic signature" },
            verify: async (...args) => { step("verify", args) }
        },
        "prompt-password": class {
            async run () { step("prompt"); return "synthetic fixture passphrase" }
        }
    }
    process.once("beforeExit", () => console.log(`FIXTURE_CALLS:${JSON.stringify(calls)}`))
    vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), {
        require: (name) => {
            assert.ok(Object.hasOwn(modules, name), `unexpected dependency: ${name}`)
            return modules[name]
        },
        console,
        process,
        __dirname: "/fixture-project"
    }, { filename: sourcePath })
}
else {
    const { test } = require("node:test")
    const sourcePath = process.env.PACKAGE_SOURCE || path.resolve(__dirname, "../npm-package.js")
    const run = (platform, failure = "none") => {
        const result = spawnSync(process.execPath, [ __filename, "--fixture", sourcePath, platform, failure ], {
            encoding: "utf8",
            timeout: 5000
        })
        assert.ifError(result.error)
        assert.equal(result.signal, null)
        assert.equal(result.stderr, "")
        const record = result.stdout.split("\n").find((line) => line.startsWith("FIXTURE_CALLS:"))
        assert.ok(record, result.stdout)
        return { ...result, calls: JSON.parse(record.slice("FIXTURE_CALLS:".length)) }
    }

    for (const platform of [ "win32", "darwin", "linux" ]) {
        test(`${platform}: successful package and signature exit zero`, () => {
            const result = run(platform)
            assert.equal(result.status, 0)
            assert.doesNotMatch(result.stdout, /ERROR:/)
            assert.equal(result.calls.at(-1).name, "verify")
            assert.deepEqual(result.calls.filter((call) => call.name === "remove-font").map((call) => call.args[1]),
                [ "node_modules/typopro-web/web/TypoPRO-Unused" ])
            const build = result.calls.find((call) => call.name === "build")
            const target = { win32: "--win", darwin: "--mac", linux: "--linux" }[platform]
            assert.deepEqual(build.args[1], [ target, "--x64" ])
            const archive = result.calls.find((call) => call.name === "zip").args[1]
            const suffix = { win32: "win", darwin: "mac", linux: "lnx" }[platform]
            assert.equal(archive, path.join("/fixture-project", `dist/Vingester-${suffix}-x64.zip`))
        })
        const shellFailures = platform === "win32" ? [ "cleanup", "remove-font" ] : [ "cleanup", "remove-font", "move" ]
        for (const failure of shellFailures) {
            test(`${platform}: returned ${failure} error stops packaging`, () => {
                const result = run(platform, `${failure}-returned`)
                assert.equal(result.status, 1)
                assert.equal(result.calls.at(-1).name, failure)
                assert.ok(result.stdout.includes(`ERROR: Error: fixture returned failure: ${failure}`))
            })
        }
        for (const failure of [ "build", "zip" ]) {
            test(`${platform}: ${failure} failure exits nonzero`, () => {
                const result = run(platform, failure)
                assert.equal(result.calls.at(-1).name, failure)
                assert.ok(result.stdout.includes(`ERROR: Error: fixture failure: ${failure}`))
                assert.equal(result.status, 1)
            })
        }
    }

    for (const failure of [ "cleanup", "glob", "remove-font", "move", "prompt", "read-archive",
        "read-private-key", "sign", "write-signature", "read-public-key", "verify" ]) {
        test(`linux: ${failure} failure exits nonzero`, () => {
            const result = run("linux", failure)
            assert.equal(result.calls.at(-1).name, failure)
            assert.ok(result.stdout.includes(`ERROR: Error: fixture failure: ${failure}`))
            assert.equal(result.status, 1)
        })
    }
}
