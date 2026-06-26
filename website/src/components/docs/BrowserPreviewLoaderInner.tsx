'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import type { RootWidget } from '@termuijs/core'
import type { VNode } from '@termuijs/jsx'

const BrowserPreview = dynamic(
    () => import('./BrowserPreview').then(m => m.BrowserPreview),
    { ssr: false }
)

interface Props {
    slug: string
    mouse?: boolean
    className?: string
}

type Loaded =
    | { kind: 'widget'; factory: () => RootWidget }
    | { kind: 'jsx'; factory: () => VNode }

export function BrowserPreviewLoaderInner({ slug, ...rest }: Props) {
    const [loaded, setLoaded] = useState<Loaded | null>(null)

    useEffect(() => {
        let cancelled = false
        // Prefer a JSX demo (hooks); fall back to a widget demo.
        import('@/data/jsxDemos')
            .then(m => {
                const fn = m.default[slug]
                if (fn) {
                    if (!cancelled) setLoaded({ kind: 'jsx', factory: fn })
                    return true
                }
                return false
            })
            .catch(() => false)
            .then(found => {
                if (found || cancelled) return
                return import('@/data/demos').then(m => {
                    const fn = m.default[slug]
                    if (fn && !cancelled) setLoaded({ kind: 'widget', factory: fn })
                })
            })
        return () => { cancelled = true }
    }, [slug])

    if (!loaded) return null
    return loaded.kind === 'jsx'
        ? <BrowserPreview jsxFactory={loaded.factory} {...rest} />
        : <BrowserPreview factory={loaded.factory} {...rest} />
}
