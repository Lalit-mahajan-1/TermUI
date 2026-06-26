// Browser stub for fs — @termuijs packages (tss importer, ui FilePicker, theme
// loaders) read the real filesystem, which a browser preview can't. Every named
// member they import/access is exported as a safe no-op so Turbopack's static
// export checks pass and the shared bundle builds. A widget that truly needs the
// FS simply won't function in-browser (it can't), but nothing else breaks.
const noop = () => {}
export const existsSync = () => false
export const readFileSync = () => ''
export const writeFileSync = noop
export const appendFileSync = noop
export const mkdirSync = noop
export const readdirSync = () => []
export const statSync = () => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
export const openSync = () => -1
export const closeSync = noop
export const readSync = () => 0
export const readFile = (_p, _o, cb) => { const f = typeof _o === 'function' ? _o : cb; f && f(null, '') }
export const writeFile = (_p, _d, _o, cb) => { const f = typeof _o === 'function' ? _o : cb; f && f(null) }
export const readdir = (_p, _o, cb) => { const f = typeof _o === 'function' ? _o : cb; f && f(null, []) }
export const mkdir = (_p, _o, cb) => { const f = typeof _o === 'function' ? _o : cb; f && f(null) }
export const watch = () => ({ close: noop, on: noop })
export const watchFile = noop
export const unwatchFile = noop
export default {
    existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync,
    statSync, openSync, closeSync, readSync, readFile, writeFile, readdir, mkdir,
    watch, watchFile, unwatchFile,
}
