const fs = require('fs')
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const p = require('path')
const url = require('url')
const mime = require('mime-types')
const request = require("request")
const ws = require('ws')
const https = require('https')
var APP = app.getPath('appData')
if (APP) {
    if (!fs.existsSync(APP+'/data')) fs.mkdirSync(APP+'/data')
    if (!fs.existsSync(p.normalize(p.join(APP, '/config.json')))) fs.writeFileSync(p.normalize(p.join(APP, '/config.json')), JSON.stringify([]))
} else {
    if (!fs.existsSync('./config.json')) fs.writeFileSync('./config.json', JSON.stringify([]))
}
var config = JSON.parse(fs.readFileSync(APP ? p.normalize(p.join(APP, './config.json')) : './config.json'))
let configure = () => {
    return new Promise((res, rej) => {
        fs.writeFile(APP + './config.json', JSON.stringify(config), err => {
            if (err) return rej(err)
            for (let i = 0; i < config.length; i++) if (config[i] && config[i].key && config[i].value) process.env[config[i].key] = config[i].value
            res(true)
        })
    })
}
if (typeof config === 'object' && config.length > 0) for (let i = 0; i < config.length; i++) if (config[i] && config[i].key && config[i].value) process.env[config[i].key] = config[i].value
const absolute = path => p.normalize(p.resolve(p.join('./', path)))
const cPath = path => {
    return absolute(p.join(app.getAppPath().split('app.asar')[0], path))
}
class Client {
    constructor(ws) {
        if (!ws) throw new Error('Missing websocket address')
        this.lastPing = null
        this.lastPingTime = null
        this.currentPing = 0
        this.attempts = 0
        this.ws = ws
        if (process.env.USERNAME && process.env.APPID) this.app = this.makeWS()
    }
    send(type, data) {
        this.app.send(JSON.stringify({ type, data }))
    }
    addFile = (title, path) => {
        return new Promise((res, rej) => {
            let stats = fs.statSync(path)
            let name = p.basename(path)
            let type = mime.lookup(p.extname(name))
            let destination = `${process.env.NAS}/${name}`
            fs.copyFile(path, destination, err => {
                if (err) return rej(err)
                this.api('/new-file', 'post', { stats, name, type, path: absolute(destination, true), title }).then(result => res(result)).catch(e => rej(e))
            })
        })
    }
    copyFile = (_id, destination) => {
        return new Promise((res, rej) => {
            this.api('/get-file', 'post', { copy: true, files: [_id] }).then(file => {
                console.log(file)
                let { path, name } = file
                if (!path) return rej('File is not local.')
                let f = destination + name
                fs.copyFile(resolve(path), f, err => {
                    if (err) return rej(err)
                    return res(f)
                })
            }).catch(e => rej(e))
        })
    }
    getFile = _id => {
        return new Promise((res, rej) => {
            this.api('/get-file', 'post', { copy: false, files: [_id] }).then(file => {
                res(file[0])
            }).catch(e => rej(e))
        })
    }
    api(page, method, data) {
        return new Promise((res, rej) => {
            let d = ''
            let options = {
                hostname: 'host',
                method: method && typeof method === 'string' ? method.toUpperCase() : 'GET',
                path: page,
                port: 443,
                headers: (!process.env.APPID || !process.env.USERNAME) ? {
                    'Content-Type': 'application/json',
                } : method ? {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${process.env.USERNAME}:${process.env.APPID}`).toString('base64')}`
                } : {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${process.env.USERNAME}:${process.env.APPID}`).toString('base64')}`,
                }
            }
            console.log(options, data)
            let req = https.request(options, resp => {
                resp.on('data', l => d += l)
                resp.on('end', () => {
                    let o
                    try {
                        o = JSON.parse(d)
                    } catch (e) {
                        return res(d)
                    }
                    return res(o)
                })
            })
            req.on('error', e => rej(e))

            if (method && method !== 'GET') req.write(typeof data === 'object' ? JSON.stringify(data) : data)
            req.end()
        })
    }
    error(e) {
        console.log(e)
        this.api('/error-report', 'POST', { error: e, date: new Date() }).catch(e => console.log(e))
    }
    getFile(link, destination) {
        return new Promise((res, rej) => {
            request(link, (err, response, data) => {
                if (err) return rej(err)
                res(true)
            }).pipe(fs.createWriteStream(destination))
        })
    }
    verifyID(_id) {
        return new Promise((res, rej) => {
            if (!_id) return rej('MISSING ID')
            this.api('/check-id', 'post', { _id }).then(result => {
                console.log(result)
                if (result.error) return rej(result.message || JSON.stringify(result))
                return res(result.username)
            }).catch(e => { console.log("FAILED"); return rej(e) })
        })
    }
    makeWS() {
        clearInterval(this.pingcheck)
        let server = new ws(this.ws)
        server.on('error', (e) => {
            if (!/Unexpected server response/.test(e)) {
                console.log(e)
                this.attempts++
                clearTimeout(this.attempter)
                this.attempter = setTimeout(() => {
                    this.app = this.makeWS()
                }, this.attempts * 1000 * 10)
            }
        })
        server.on('open', () => {
            let auth = {}
            auth[process.env.USERNAME] = process.env.APPID
            this.sendPing()
            server.send(JSON.stringify({ type: 'auth', data: auth }))
            this.pingcheck = setInterval(() => this.sendPing(), 10000)
        })
        server.on('close', (e) => {
            this.server = false
            clearTimeout(this.attempter)
            this.attempter = setTimeout(() => {
                this.app = this.makeWS()
            }, this.attempts * 1000 * 10)
        })
        server.on('message', async (message) => {
            let that
            try {
                that = JSON.parse(message)
            } catch (e) {
                return console.log(`RECEIVED DATA: ${message}`)
            }
            let { data, type } = that
            switch (type) {
                case 'ping': {
                    if (this.lastPing !== data) {
                        this.sendPing()
                    } else {
                        this.currentPing = new Date().getTime() - this.lastPingTime
                        console.log(`Current Ping: ${this.currentPing}ms`)
                    }
                    break
                }
                case 'new file': {
                    if (!fs.existsSync('./recentlyadded')) fs.mkdirSync('./recentlyadded')
                    let link = data.link
                    if (!link) return console.log('No link for download')
                    let destination = await (data.title ? (async () => {
                        await Title.findOne({ _id: data.title }).then(result => {
                            Directory.findOne({ _id: result.directory }).then(result => {
                                return result.path
                            }).catch(e => console.log(e))
                        }).catch(e => console.log(e))
                    })() : './recentlyadded/' + data.name)
                    this.getFile(link, destination).then(result => {
                        console.log(result)
                    }).catch(e => console.log(e))
                    break
                }
                case 'auth': {
                    if (!data && typeof that.error !== 'boolean' && that.error !== false) {
                        let auth = {}
                        auth[process.env.USERNAME] = process.env.APPID
                        server.send(JSON.stringify({ type: 'auth', data: auth }))
                        this.server = false
                    } else {
                        this.server = true
                    }
                    break
                }
                default: { return }
            }
        })
        return server
    }
    sendPing() {
        this.lastPing = Math.floor(Math.random() * 10000)
        this.lastPingTime = new Date().getTime()
        this.send('ping', this.lastPing)
    }
}
var client = new Client('websocket')
var mainWindow = null
ipcMain.handle("add-file", (e, args) => client.addFile(args.title, args.path).then(result => result).catch(e => ({ error: true, message: e })))
ipcMain.handle("open-file", (e, args) => client.getFile(args._id).then(result => {
    shell.openItem(resolve(result.path));
    return true
}).catch(e => ({ error: true, message: e })))
ipcMain.handle("delete-file", (e, args) => client.deleteFile(args._id).then(result => result).catch(e => ({ error: true, message: e })))
ipcMain.handle("copy-file", (e, args) => client.copyFile(args._id, args.destination || process.env.DEFAULTFOLDER).then(result => result).catch(e => ({ error: true, message: e })))
ipcMain.handle("cookie", async (e, args) => {
    let cookie = () => {
        return new Promise(async (res, rej) => {
            try {
                const win = new BrowserWindow({
                    width: 800,
                    height: 600,
                    show: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    },
                    title: 'Web App'
                })
                win.loadURL(args);
                win.once('ready-to-show', () => {
                    win.close()
                    return res(true)
                })
                win.on('error', e => rej(e))
            } catch (e) {
                rej(e)
            }
        })
    }
    let a = await cookie().catch(e => ({ error: true, message: e }))
    return a
})
ipcMain.handle("logout", async (e, args) => {
    let log = () => {
        return new Promise(async (res, rej) => {
            try {
                const win = new BrowserWindow({
                    width: 800,
                    height: 600,
                    show: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    },
                    title: 'Web App'
                })
                win.loadURL(args);
                win.once('ready-to-show', () => {
                    win.close()
                    return res(true)
                })
                win.on('error', e => rej(e))
            } catch (e) {
                rej(e)
            }
        })
    }
    let a = await log().catch(e => ({ error: true, message: e }))
    return a
})
ipcMain.handle('selectDir', async (e, args) => {
    let r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    })
    console.log(r)
    return r.filePaths
})
ipcMain.handle('selectFile', async (e, args) => {
    let r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections']
    })
    console.log(r)
    return r
})
ipcMain.handle('appID', (e, args) => {
    client.verifyID(args).then(result => {
        if (!result) return ({ error: true, message: 'Invalid App ID' })
        config.push({ key: "APPID", value: args }, { key: "USERNAME", value: result })
        configure()
        mainWindow.loadURL(url.format({
            pathname: cPath('/build/index.html'),
            protocol: "file:",
            slashes: true
        }))
        return true
    }).catch(e => { client.error(e); return ({ error: true, message: 'Issue verifying appID' }) })
})
function createWindow(path = cPath('/build/index.html'), script = cPath('/app/script.js'), URI) {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: absolute(script)
        },
        title: 'Web App'
    })
    win.loadURL(URI && typeof URI !== 'undefined' && URI !== 'undefined' ? URI : url.format({
        pathname: absolute(path),
        protocol: "file:",
        slashes: true
    }))
    win.once('ready-to-show', () => win.show());
    win.on('closed', function () {

    })
    return win
}
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
app.whenReady().then(async () => {
    mainWindow = createWindow()
    if (!process.env.NAS || !fs.existsSync(process.env.NAS)) {
        if (process.platform !== 'darwin') await dialog.showMessageBoxSync(mainWindow, { message: 'Please select the NAS drive location.', buttonLabel: 'Select Folder' })
        let r = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        })
        if (!r || !r.filePaths || r.filePaths.length < 1) {
            await dialog.showErrorBox('Unable to locate NAS', 'We were unable to locate the NAS drive on your system. Please relaunch app.')
            app.quit()
        }
        config.push({ key: 'NAS', value: r.filePaths[0] })
        configure()
    }
    if (!process.env.APPID) {
        if (process.platform !== 'darwin') await dialog.showMessageBoxSync(mainWindow, { message: 'You must register this application before it can be used.' })
        mainWindow.loadURL(url.format({
            pathname: cPath('/app/appID.html'), // relative path to the HTML-file
            protocol: "file:",
            slashes: true
        }))
    }
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
})