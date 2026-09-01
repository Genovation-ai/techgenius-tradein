/**
 * Tech Genius Trade-In — Framer Code Component
 *
 * Framer → Assets → Code → New Component → paste this whole file.
 * Then drag the component onto /sell and set "API URL" in the right-hand panel.
 *
 * Everything is configured from the Framer panel — you never rebuild the JS to
 * change the backend, the org, or the look.
 */
import { useEffect, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"

type Props = {
    apiUrl: string
    scriptUrl: string
    cssUrl: string
    orgSlug: string
    minHeight: number
}

export default function TechGeniusTradeIn(props: Props) {
    const { apiUrl, scriptUrl, cssUrl, orgSlug, minHeight } = props
    const hostRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (typeof document === "undefined") return
        const host = hostRef.current
        if (!host || !apiUrl || !scriptUrl) return

        // The embed looks for exactly this id.
        host.id = "tg-trade-in-root"
        host.setAttribute("data-api", apiUrl.replace(/\/$/, ""))
        if (orgSlug) host.setAttribute("data-org", orgSlug)

        // Also set the global, so the origin is known even if the script runs
        // before Framer has finished attaching this node.
        ;(window as any).TG_TRADE_IN_API = apiUrl.replace(/\/$/, "")

        if (cssUrl && !document.querySelector('link[data-tg-trade-in="css"]')) {
            const link = document.createElement("link")
            link.rel = "stylesheet"
            link.href = cssUrl
            link.setAttribute("data-tg-trade-in", "css")
            document.head.appendChild(link)
        }

        const existing = document.querySelector(
            'script[data-tg-trade-in="js"]'
        ) as HTMLScriptElement | null

        if (!existing) {
            const script = document.createElement("script")
            script.src = scriptUrl
            script.defer = true
            script.setAttribute("data-tg-trade-in", "js")
            document.body.appendChild(script)
        } else {
            // Framer re-runs effects on every canvas edit; remount in place.
            ;(window as any).TechGeniusTradeIn?.remount?.()
        }
    }, [apiUrl, scriptUrl, cssUrl, orgSlug])

    return <div ref={hostRef} style={{ width: "100%", minHeight }} />
}

TechGeniusTradeIn.defaultProps = {
    apiUrl: "",
    scriptUrl: "",
    cssUrl: "",
    orgSlug: "tech-genius",
    minHeight: 1100,
}

addPropertyControls(TechGeniusTradeIn, {
    apiUrl: {
        type: ControlType.String,
        title: "API URL",
        placeholder: "https://api.techgenius.ca",
        description: "Your deployed trade-in backend. Required.",
    },
    scriptUrl: {
        type: ControlType.String,
        title: "Script URL",
        placeholder: "https://.../tg-trade-in.js",
    },
    cssUrl: {
        type: ControlType.String,
        title: "CSS URL",
        placeholder: "https://.../tg-trade-in.css",
    },
    orgSlug: {
        type: ControlType.String,
        title: "Org slug",
        defaultValue: "tech-genius",
    },
    minHeight: {
        type: ControlType.Number,
        title: "Min height",
        defaultValue: 1100,
        min: 600,
        max: 2600,
        step: 50,
    },
})
