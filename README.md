# Browserose MCP

**MCP Tool for Agents to control the Google Chrome browser.**

Browserose MCP is an MCP (Model Context Protocol) server that lets AI agents and IDEs control **Google Chrome** via Playwright, with full **iframe support**: snapshot and interact inside iframes (e.g. ALM SCORM players, embedded apps).

## Requirements

- Node.js 18+
- Chrome installed (or set `PLAYWRIGHT_MCP_USE_CHROMIUM=1` to use Chromium)
- Playwright browsers: `npx playwright install chromium` (or `chrome` if available)

## Install and build

```bash
npm install
npx playwright install chromium
npm run build
```

## Cursor / IDE configuration

Add to `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "playwright-chrome": {
      "command": "node",
      "args": ["/absolute/path/to/Browserose-MCP/build/index.js"]
    }
  }
}
```

Restart Cursor after editing `mcp.json`.

## Environment variables

- **`PLAYWRIGHT_MCP_HEADLESS`** — set to `1` or `true` to run the browser headless (default: headed so you see the window).
- **`PLAYWRIGHT_MCP_USE_CHROMIUM`** — set to `1` or `true` to use Playwright's Chromium instead of system Chrome.

## Tools (quick reference)

| Tool | Purpose |
|------|--------|
| `browser_navigate` | Go to URL |
| `browser_go_back` / `browser_go_forward` | History |
| `browser_snapshot` | Accessibility-like tree of the page; use `includeFrames: true` to include same-origin iframes |
| `browser_snapshot_frame` | Snapshot a single iframe by selector (e.g. `iframe`, `iframe#pplayer_iframe`) |
| `browser_click` | Click by ref; optional `frameSelector` for elements inside an iframe |
| `browser_type` | Type text; optional `ref`, `frameSelector`, `submit` |
| `browser_type_locator` | Type into element by role/text/css; optional `frameSelector` (omit = main page) |
| `browser_hover` | Hover by ref; optional `frameSelector` |
| `browser_select_option` | Select option(s) by ref; optional `frameSelector` |
| `browser_press_key` | Press a key; optional `frameSelector` |
| `browser_screenshot` | Page or iframe screenshot; optional `frameSelector` |
| `browser_click_at` | Click at `(x, y)` relative to a frame's viewport (for canvas/cross-origin when refs fail); requires `frameSelector`, `x`, `y` |
| `browser_click_locator` | Click by Playwright locator inside a frame (works in cross-origin). Use `frameSelector` + one of: `role`+`name`, `text`, or `css`. No snapshot needed. |
| `browser_list_clickables` | List visible buttons/links in a frame (text, enabled/disabled, optional bbox). Use to discover what to click; works in cross-origin iframes. |
| `browser_frame_probe` | Diagnostic: run inside frame to get url, title, readyState, button/clickable counts, textSample. If probe fails or counts=0, UI may be canvas. |
| `browser_frame_bbox` | Get frame bounding box (x, y, width, height) in page coordinates. |
| `browser_click_at_rel` | Click at relative (rx, ry) in 0..1 inside the frame (e.g. 0.5, 0.9 = center-bottom). Uses Playwright page.mouse.click. |
| `browser_frame_inventory` | Inside frame: list child iframes (id, name, src, rect), canvas (rect), shadowHosts count, bodyRect. Use to see if UI is in nested iframe or canvas. |
| `browser_hit_test_rel` | elementFromPoint at (rx, ry) in frame; returns tag, id, class, rect, pointerEvents, cursor (and iframe src/name). Confirms where clicks land. |
| `browser_click_at_rel_debug` | Frame screenshot + text with page coords and in-frame pixel where click_at_rel(rx, ry) would click. |
| `browser_wait` | Sleep (seconds) |

---

## Tools reference and use cases

Detailed description of each tool and when to use it. Optional `frameSelector` uses ` >> ` for nested iframes (e.g. `iframe#a >> iframe#b`).

### Navigation

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_navigate`** | Opens a URL in the current tab. | Starting a flow, opening login pages, course URLs, or any target site. |
| **`browser_go_back`** | Goes back in history. | Undoing a navigation or returning from a redirect. |
| **`browser_go_forward`** | Goes forward in history. | Repeating a step after going back. |

### Snapshot and ref-based interaction

These tools use an accessibility/DOM snapshot to get **refs** (e.g. `s1e2`). You then pass that ref to click, type, hover, or select. Best when the page (or iframe) is same-origin and has a normal DOM.

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_snapshot`** | Captures an accessibility-like tree of the current page. Use `includeFrames: true` to include same-origin iframes. | Discovering structure and getting refs for main page and embedded frames in one call. |
| **`browser_snapshot_frame`** | Snapshots a single iframe by selector. For chained selectors (` >> `), uses CDP when in-frame evaluate isn't possible. | Inspecting one frame's tree; getting refs for elements inside that frame (same-origin or when CDP can provide refs). |
| **`browser_click`** | Clicks the element identified by ref. Optional `frameSelector` when the element is inside an iframe. | Buttons, links, checkboxes—any clickable from the snapshot. |
| **`browser_type`** | Types text into the focused element or the element identified by ref. Optional `frameSelector`, `submit` (press Enter). | Text inputs, search boxes, login fields. |
| **`browser_hover`** | Hovers over the element identified by ref. Optional `frameSelector`. | Opening dropdowns or tooltips before clicking. |
| **`browser_select_option`** | Selects option(s) in a dropdown by ref. Optional `frameSelector`. | Select elements, language pickers, filters. |
| **`browser_press_key`** | Sends a key (e.g. Enter, Tab, ArrowRight). Optional `frameSelector` to target a frame. | Submitting forms, keyboard navigation, escaping modals. |

### Locator-based interaction (no snapshot)

These tools use Playwright locators (role+name, text, or css) and **do not require a snapshot**. They work in cross-origin iframes and are the main escape hatch when refs aren't available or snapshot is empty.

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_click_locator`** | Clicks an element by locator: `role`+`name`, `text`, or `css`. Omit `frameSelector` for main page. | Cross-origin iframes, login buttons ("Log in", "Continue"), SCORM "Next", any button/link when you know its label or selector. |
| **`browser_type_locator`** | Types into an element found by role/text/css. Omit `frameSelector` for main page. | Login fields (e.g. `css: input[type=email]`, `role: textbox`), search boxes, any input when snapshot isn't used. |
| **`browser_list_clickables`** | Lists visible buttons and links in a frame (text, enabled/disabled, optional bbox). | Discovering what's clickable in a frame without a snapshot; verifying that the right frame has the expected UI (e.g. "Next" in SCORM content). |

### Coordinate-based interaction (escape hatch)

When snapshot and locators both fail (e.g. canvas, custom-rendered UI, or wrong frame depth), use coordinates relative to a frame.

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_frame_bbox`** | Returns the frame's bounding box (x, y, width, height) in **page** coordinates. | Converting relative positions to absolute (x, y) for `browser_click_at`, or understanding frame position. |
| **`browser_click_at`** | Clicks at pixel `(x, y)` relative to the frame's viewport. Requires `frameSelector`, `x`, `y`. | Canvas or non-DOM UI when you know exact coordinates (e.g. from a screenshot). |
| **`browser_click_at_rel`** | Clicks at **relative** position `(rx, ry)` in `[0..1]` inside the frame (e.g. `0.5`, `0.9` = center-bottom). Uses Playwright's mouse. | Clicking "bottom-right" or "center" of a frame when you don't have pixel coords; quick fallback for known layout. |
| **`browser_click_at_rel_debug`** | Returns a screenshot of the frame **and** the exact page coordinates and in-frame pixel where `click_at_rel(rx, ry)` would click. | Debugging: confirm that (rx, ry) lands on the right element before using `browser_click_at_rel`. |

### Diagnostics (finding the right frame / layer)

When a frame shows no buttons or empty text in the snapshot, the real UI is often in a **child iframe**, **canvas**, or **shadow DOM**. These tools help you find it.

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_frame_probe`** | Runs a small script inside the frame: returns `url`, `title`, `readyState`, counts of buttons/clickables, and a short `textSample`. | Quick check: "Does this frame have any DOM?" If `buttons: 0`, `clickables: 0`, `textSample: ""`, the visible UI is likely in a child iframe or canvas. |
| **`browser_frame_inventory`** | Lists **child iframes** (id, name, src, rect), **canvas** elements (rect), count of shadow roots, and `bodyRect`. | When probe says "no content": find the real content frame (e.g. ALM SCORM's `iframe#content-frame`) or confirm the UI is canvas. Then extend the frame selector chain and use locators in that frame. |
| **`browser_hit_test_rel`** | Uses `elementFromPoint(rx*width, ry*height)` inside the frame; returns tag, id, class, rect, pointerEvents, cursor; for iframes, src/name. | Verify what element a relative point (rx, ry) hits—e.g. "Is (0.5, 0.92) really the Next button or an overlay?" |

### Utility

| Tool | What it does | Use cases |
|------|----------------|-----------|
| **`browser_screenshot`** | Takes a screenshot of the full page or a specific iframe (`frameSelector`). | Visual verification, debugging layout, or feeding into vision models. |
| **`browser_wait`** | Pauses for a given number of seconds. | Letting the page or iframe finish loading before snapshot or click. |

---

## Use cases in practice

- **Normal web automation (main page)**  
  Use `browser_snapshot` (or `browser_snapshot_frame` with no/minimal nesting) to get refs, then `browser_click`, `browser_type`, `browser_hover`, `browser_select_option` with those refs. Optional `browser_screenshot` for verification.

- **Login flows**  
  Often on the main page: `browser_type_locator` and `browser_click_locator` with `role`/`name` or `text` (e.g. email → Continue → password → Log in). No snapshot required.

- **Single iframe, same-origin**  
  `browser_snapshot_frame` with `frameSelector: "iframe#id"` → get refs → `browser_click` / `browser_type` with the same `frameSelector`.

- **Cross-origin or "empty" iframe**  
  Snapshot may be empty or refs may not work. Use **locators**: `browser_list_clickables` with `frameSelector` to see what's there, then `browser_click_locator` and `browser_type_locator` with the same `frameSelector` and role/text/css.

- **ALM / SCORM (nested iframes)**  
  The visible lesson UI is often in a **third-level** iframe. If `browser_frame_probe` on `iframe#pplayer_iframe >> iframe#modulePlayerIframe` shows `clickables: 0`, run **`browser_frame_inventory`** on that chain; it will list child iframes (e.g. `iframe#content-frame`). Extend the chain to `... >> iframe#content-frame` and use `browser_list_clickables` and `browser_click_locator` (e.g. `role: "button"`, `name: "Next"`) there. One-line takeaway: when the frame has no DOM content, use **frame_inventory** to find the real content iframe, then add it to the chain.

- **Canvas or custom-rendered UI**  
  If frame_inventory shows a large canvas and no useful iframe, or locators don't match: use `browser_click_at_rel_debug` to see where (rx, ry) lands, then `browser_click_at_rel` with adjusted (rx, ry), or `browser_frame_bbox` + `browser_click_at` with computed (x, y).

- **Debugging "click does nothing"**  
  Check: (1) Correct frame? → `browser_frame_probe` and `browser_frame_inventory`. (2) Right element? → `browser_list_clickables` in that frame; `browser_hit_test_rel` to see what's under (rx, ry). (3) Right coordinates? → `browser_click_at_rel_debug`.

---

## Using iframes (including cross-origin / ALM SCORM)

1. Navigate to a page that contains an iframe (e.g. ALM course page).
2. Call `browser_snapshot` with `includeFrames: true` to get the main page plus same-origin iframes, or call `browser_snapshot_frame` with `frameSelector: "iframe"` (or `iframe#id`) to get only that frame's tree.
3. Use the returned refs with `browser_click`, `browser_type`, etc., and pass the same `frameSelector`. For nested iframes use a chained selector with ` >> `, e.g. `iframe#pplayer_iframe >> iframe#modulePlayerIframe`.

Example: click "Next" inside the first iframe:

- `browser_snapshot_frame` with `frameSelector: "iframe"` → get ref for the "Next" button (e.g. `f1e2`).
- `browser_click` with `ref: "f1e2"`, `frameSelector: "iframe"`.

**Escape hatch (cross-origin / SCORM):** For frames where snapshot fails, use Playwright locators directly (no AX/DOMSnapshot):

- `browser_list_clickables` with `frameSelector: "iframe#pplayer_iframe >> iframe#modulePlayerIframe"` → lists buttons/links with text and enabled/disabled.
- **ALM SCORM:** The visible lesson UI (e.g. "Next", "Learning objectives") lives in a **third-level** iframe. Use `browser_frame_inventory` on `iframe#pplayer_iframe >> iframe#modulePlayerIframe` to see child iframes; then chain to the content frame: `iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame`. Use that selector with `browser_list_clickables` and `browser_click_locator` (e.g. `role: "button"`, `name: "Next"`).
- `browser_click_locator` with the same `frameSelector` and `role: "button"`, `name: "Next"` (or `text: "Next"`) → clicks the element. Works because Playwright targets the frame's context directly.

**Cross-origin / SCORM (AX tree empty):** The server also uses a 3-tier snapshot for frames:

1. **Tier A** — CDP `Accessibility.getFullAXTree` (refs with `backendDOMNodeId`; click via box model).
2. **Tier B** — If AX is empty, CDP `DOMSnapshot.captureSnapshot` (refs with viewport coordinates; click via `Input.dispatchMouseEvent`).
3. **Tier C** — Use `browser_screenshot` with `frameSelector`, then `browser_click_at` with the same `frameSelector` and `(x, y)` to click by coordinates (e.g. canvas or when both AX and DOM snapshot fail).

---

## License and author

- **License:** This project is **open source**. Use and modify it freely.
- **Developer:** **ETTALBI OMAR**
