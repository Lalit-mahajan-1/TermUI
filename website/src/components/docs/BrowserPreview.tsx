'use client'

// App.requestRender() uses setImmediate — not available in browser with Turbopack
if (typeof (globalThis as any).setImmediate === 'undefined') {
    ;(globalThis as any).setImmediate = (fn: () => void) => setTimeout(fn, 0)
    ;(globalThis as any).clearImmediate = clearTimeout
}

import { Buffer } from 'buffer'
import { useEffect, useRef } from 'react'
import type { RootWidget, AppOptions } from '@termuijs/core'
import { App, ColorDepth } from '@termuijs/core'
import { Box, type Widget } from '@termuijs/widgets'
import {
    reconcile,
    reRenderComponent,
    setRequestRender,
    collectInputHandlers,
    unmountAll,
    type VNode,
} from '@termuijs/jsx'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// ── Minimal EventEmitter shim (no Node.js dep) ───────────────────────
class BrowserEmitter {
    private _h = new Map<string, Set<(d: unknown) => void>>()
    on(ev: string, fn: (d: unknown) => void) {
        if (!this._h.has(ev)) this._h.set(ev, new Set())
        this._h.get(ev)!.add(fn)
        return this
    }
    off(ev: string, fn: (d: unknown) => void) { this._h.get(ev)?.delete(fn); return this }
    once(ev: string, fn: (d: unknown) => void) {
        const w = (d: unknown) => { this.off(ev, w); fn(d) }
        return this.on(ev, w)
    }
    emit(ev: string, d?: unknown) { this._h.get(ev)?.forEach(f => f(d)); return true }
    removeAllListeners() { this._h.clear(); return this }
}

// ── Stdout shim: xterm.write() ← terminal.stdout.write() ─────────────
function makeStdout(term: XTerm): NodeJS.WriteStream {
    const ee = new BrowserEmitter()
    return Object.assign(ee, {
        columns: term.cols,
        rows: term.rows,
        isTTY: true,
        writable: true,
        write(chunk: string | Buffer, encoding?: unknown, cb?: () => void): boolean {
            let str = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8')
            // Fix full-clear flash: TermUI emits 2J+3J+H on overflow; replace with cursor-home only
            str = str.replace(/\x1b\[2J\x1b\[3J\x1b\[H/g, '\x1b[H')
            term.write(str)
            if (typeof encoding === 'function') (encoding as () => void)()
            else if (typeof cb === 'function') cb()
            return true
        },
        end() {},
        cork() {},
        uncork() {},
        setDefaultEncoding() { return this },
    }) as unknown as NodeJS.WriteStream
}

// ── Stdin shim: terminal.stdin.on('data') ← xterm.onData() ───────────
function makeStdin(term: XTerm): NodeJS.ReadStream {
    const ee = new BrowserEmitter()
    const shim = Object.assign(ee, {
        isTTY: true,
        readable: true,
        isRaw: true,
        setEncoding() {},
        setRawMode() { return shim as unknown as NodeJS.ReadStream },
        resume() { return shim as unknown as NodeJS.ReadStream },
        pause() { return shim as unknown as NodeJS.ReadStream },
        ref() {},
        unref() {},
        read() { return null },
    }) as unknown as NodeJS.ReadStream

    // Wire xterm input → stdin 'data' event (InputParser listens here)
    term.onData((data) => {
        ee.emit('data', Buffer.from(data, 'utf8'))
        ee.emit('readable')
    })

    return shim
}

// ── BrowserPreview React component ────────────────────────────────────
export interface BrowserPreviewProps {
    /** Widget demo: returns a RootWidget mounted directly. */
    factory?: () => RootWidget
    /** JSX demo: returns a VNode reconciled + wired for hooks/re-render/input. */
    jsxFactory?: () => VNode
    mouse?: boolean
    className?: string
}

export function BrowserPreview({
    factory,
    jsxFactory,
    mouse = false,
    className,
}: BrowserPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const term = new XTerm({
            convertEol: true,
            disableStdin: false,
            cursorBlink: true,
            scrollback: 0,
            theme: {
                background: '#0a0a12',
                foreground: '#e8e8f0',
                cursor: '#00ff88',
                cursorAccent: '#0a0a12',
            },
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(el)
        fitAddon.fit() // fills container dimensions → sets actual cols/rows
        term.focus()   // capture keyboard immediately without requiring a click

        // Refit whenever the container resizes so cols/rows stay in sync
        const ro = new ResizeObserver(() => fitAddon.fit())
        ro.observe(el)

        const stdout = makeStdout(term)
        const stdin = makeStdin(term)

        // Keep stdout.columns/rows in sync with terminal resize
        term.onResize(({ cols: c, rows: r }) => {
            ;(stdout as NodeJS.WriteStream & { columns: number; rows: number }).columns = c
            ;(stdout as NodeJS.WriteStream & { columns: number; rows: number }).rows = r
            ;(stdout as unknown as BrowserEmitter).emit('resize')
        })

        if (mouse) {
            // Enable SGR button-event mouse tracking
            term.write('\x1b[?1002h\x1b[?1006h')
        }

        const opts: AppOptions = {
            stdout: stdout as unknown as NodeJS.WriteStream,
            stdin: stdin as unknown as NodeJS.ReadStream,
            skipFallback: true,
            colorDepth: ColorDepth.TrueColor,
            mouse,
            screenMode: 'alternate',
            fps: 30,
        }

        // App.ts registers SIGINT/SIGTERM/uncaughtException — process.on is undefined in browser
        // ponytail: stub only missing methods; no-op signals are fine in a browser iframe context
        const proc = process as unknown as Record<string, unknown>
        if (typeof proc['on'] !== 'function') proc['on'] = () => process
        if (typeof proc['off'] !== 'function') proc['off'] = () => process
        if (typeof proc['exit'] !== 'function') proc['exit'] = () => {}

        // App never auto-discovers focusables — must register manually before mount()
        // so FocusManager queues the focus event for replay when focus.start() fires
        const registerFocusables = (w: any) => {
            if (w?.id && w?.focusable) {
                app.focus.register({ id: w.id, tabIndex: w.tabIndex ?? 0, focusable: true })
            }
            for (const child of (w?._children ?? w?.children ?? [])) {
                registerFocusables(child)
            }
        }

        let app: App
        let isJsx = false

        if (jsxFactory) {
            // ── JSX demo: reconcile VNode → widget tree, wire hooks + re-render + input ──
            // Mirrors @termuijs/jsx render(), but mounts against our shimmed App.
            isJsx = true
            const element = jsxFactory()
            let rootWidget: Widget = reconcile(element)
            const rootBox = new Box({ flexDirection: 'column', width: '100%', height: '100%' })
            rootBox.addChild(rootWidget)
            app = new App(rootBox as unknown as RootWidget, opts)

            // useState/useEffect-triggered re-render loop (fiber state preserved across renders)
            setRequestRender(() => {
                const instances: Map<Widget, { fiber: unknown }> =
                    (globalThis as Record<string, any>).__termuijs_instances
                const rootInstance = instances?.get(rootWidget) as any
                const newRoot: Widget = rootInstance
                    ? reRenderComponent(rootInstance)
                    : reconcile(element)
                rootBox.clearChildren()
                rootBox.addChild(newRoot)
                rootBox.markDirty()
                rootWidget = newRoot
                app.screen.invalidate()
                app.requestRender()
            })

            // Dispatch key events to useInput handlers via the fiber tree
            app.events.on('key', (event: unknown) => {
                const instances: Map<Widget, { fiber: unknown }> =
                    (globalThis as Record<string, any>).__termuijs_instances
                const rootInstance = instances?.get(rootWidget) as any
                if (rootInstance?.fiber) {
                    for (const handler of collectInputHandlers(rootInstance.fiber)) {
                        handler(event as never)
                    }
                }
            })

            registerFocusables(rootBox)
        } else {
            // ── Widget demo: mount the RootWidget directly ──
            const widget = factory!()
            app = new App(widget, opts)
            registerFocusables(widget)
        }

        app.mount().catch(console.error)

        // Re-fit after browser has computed final layout — onResize propagates cols/rows to App
        const rafId = requestAnimationFrame(() => fitAddon.fit())

        return () => {
            cancelAnimationFrame(rafId)
            ro.disconnect()
            if (isJsx) {
                setRequestRender(() => {}) // detach stale re-render closure before teardown
                unmountAll()
            }
            app.unmount()
            term.dispose()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ background: '#0a0a12' }}
        />
    )
}
