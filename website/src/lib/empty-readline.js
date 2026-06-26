// Browser stub for readline — @termuijs/ui prompts need a real TTY, absent in
// the browser. createInterface returns an inert interface so the bundle builds.
export const createInterface = () => ({
    question: (_q, cb) => cb && cb(''),
    close: () => {},
    on: () => {},
})
export default { createInterface }
