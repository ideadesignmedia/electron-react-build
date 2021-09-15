const { ipcRenderer } = require('electron');
class Desktop {
    copyFile = (_id, destination) => new Promise((res, rej) => {
        if (!_id || !destination) return rej('Missing _id or destination')
        ipcRenderer.invoke('copy-file', { _id, destination }).then(result => {
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    deleteFile = (_id) => new Promise((res, rej) => {
        if (!_id) return rej('Missing _id')
        ipcRenderer.invoke('delete-file', { _id }).then(result => {
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    openFile = (_id) => new Promise((res, rej) => {
        if (!_id) return rej('Missing _id')
        ipcRenderer.invoke('open-file', { _id }).then(result => {
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    addFile = (path, title = null) => new Promise((res, rej) => {
        if (!path) return rej('Missing file path')
        ipcRenderer.invoke('add-file', { path, title }).then(result => {
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    getCookie = url => new Promise((res, rej) => {
        if (!url) return rej('Missing URL')
        console.log(url)
        ipcRenderer.invoke('cookie', url).then(result => {
            console.log(result)
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    LogOut = url => new Promise((res, rej) => {
        if (!url) return rej('Missing URL')
        ipcRenderer.invoke('logout', url).then(result => {
            if (result.error) return rej(result.message || JSON.stringify(result))
            res(result)
        }).catch(e => rej(e))
    })
    selectDirectory = () => new Promise((res, rej) => ipcRenderer.invoke('selectDir').then(result => res(result)).catch(e => rej(e)))
    selectFile = () => new Promise((res, rej) => ipcRenderer.invoke('selectFile').then(result => res(result)).catch(e => rej(e)))
    addAppID = id => new Promise((res, rej) => ipcRenderer.invoke('appID', id).then(result => {
        if (result.error) return rej(result.message || JSON.stringify(result))
        res(result)
    }).catch(e => rej(e)))
}
window.DESKTOP = new Desktop()