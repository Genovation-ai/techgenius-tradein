/**
 * Tech Genius Trade-In — Framer Code Component
 *
 * Paste this into Framer: Assets → Code → New Component
 * (or ask Framer AI to create/replace the Sell wizard Code Component with THIS file).
 *
 * Loads the real trade-in app (bundled product photos) from public HTTPS.
 * Does NOT need Framer Assets hosting for .css / .js files.
 */
import { useEffect, useId, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"

const DEFAULT_CSS = "https://litter.catbox.moe/a28fbh.css"
const DEFAULT_JS = "https://litter.catbox.moe/56xasx.js"
const DEFAULT_IFRAME = "https://litter.catbox.moe/a3lyug.html"

type Props = {
  mode: "script" | "iframe"
  cssUrl: string
  jsUrl: string
  iframeUrl: string
  minHeight: number
}

export default function TechGeniusTradeIn(props: Props) {
  const {
    mode = "iframe",
    cssUrl = DEFAULT_CSS,
    jsUrl = DEFAULT_JS,
    iframeUrl = DEFAULT_IFRAME,
    minHeight = 1100,
  } = props

  const reactId = useId().replace(/:/g, "")
  const rootId = `tg-trade-in-root-${reactId}`
  const mounted = useRef(false)

  useEffect(() => {
    if (mode !== "script") return
    if (typeof document === "undefined") return

    const root = document.getElementById(rootId)
    if (!root) return

    // Embed script looks for exactly #tg-trade-in-root
    root.id = "tg-trade-in-root"

    if (!document.querySelector(`link[data-tg-trade-in="css"]`)) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = cssUrl
      link.setAttribute("data-tg-trade-in", "css")
      document.head.appendChild(link)
    }

    const existing = document.querySelector(
      `script[data-tg-trade-in="js"]`,
    ) as HTMLScriptElement | null

    if (!existing) {
      const script = document.createElement("script")
      script.src = jsUrl
      script.defer = true
      script.setAttribute("data-tg-trade-in", "js")
      document.body.appendChild(script)
      mounted.current = true
    } else if ((window as any).TechGeniusTradeIn?.remount) {
      ;(window as any).TechGeniusTradeIn.remount()
    }

    return () => {
      // keep assets cached across Framer preview remounts
    }
  }, [mode, cssUrl, jsUrl, rootId])

  if (mode === "iframe") {
    return (
      <iframe
        title="Tech Genius Trade-In"
        src={iframeUrl}
        style={{
          width: "100%",
          height: minHeight,
          border: "none",
          display: "block",
          background: "transparent",
        }}
        allow="camera; microphone; clipboard-write"
      />
    )
  }

  return (
    <div
      id={rootId}
      style={{
        width: "100%",
        minHeight,
        display: "block",
      }}
    />
  )
}

TechGeniusTradeIn.defaultProps = {
  mode: "iframe",
  cssUrl: DEFAULT_CSS,
  jsUrl: DEFAULT_JS,
  iframeUrl: DEFAULT_IFRAME,
  minHeight: 1100,
}

addPropertyControls(TechGeniusTradeIn, {
  mode: {
    type: ControlType.Enum,
    title: "Mode",
    options: ["iframe", "script"],
    optionTitles: ["Iframe (recommended)", "Script inject"],
    defaultValue: "iframe",
  },
  minHeight: {
    type: ControlType.Number,
    title: "Min height",
    defaultValue: 1100,
    min: 600,
    max: 2400,
    step: 50,
  },
  iframeUrl: {
    type: ControlType.String,
    title: "Iframe URL",
    defaultValue: DEFAULT_IFRAME,
    hidden: (p) => p.mode !== "iframe",
  },
  cssUrl: {
    type: ControlType.String,
    title: "CSS URL",
    defaultValue: DEFAULT_CSS,
    hidden: (p) => p.mode !== "script",
  },
  jsUrl: {
    type: ControlType.String,
    title: "JS URL",
    defaultValue: DEFAULT_JS,
    hidden: (p) => p.mode !== "script",
  },
})
