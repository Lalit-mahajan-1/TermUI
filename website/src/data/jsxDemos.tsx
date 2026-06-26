/** @jsxImportSource @termuijs/jsx */
// Live demos for @termuijs/jsx hooks. Each entry returns a VNode; BrowserPreview
// reconciles it and wires the fiber re-render loop + useInput dispatch, so the
// hooks run for real (state updates, effects, keyboard interaction).
import type { VNode } from '@termuijs/jsx'
import { useCounter, useInput } from '@termuijs/jsx'

function UseCounterDemo() {
    const [count, { increment, decrement, reset }] = useCounter(0, { min: 0, max: 10 })
    useInput((key) => {
        if (key === '+' || key === '=') increment()
        else if (key === '-' || key === '_') decrement()
        else if (key === 'r') reset()
    })
    return (
        <box flexDirection="column" padding={1} gap={1}>
            <text bold color="cyan">useCounter</text>
            <text>Count: <text bold color="green">{String(count)}</text>  (0–10)</text>
            <text dim>press + / − to change · r to reset</text>
        </box>
    )
}

const jsxDemos: Record<string, () => VNode> = {
    'use-counter': () => <UseCounterDemo />,
}

export default jsxDemos
