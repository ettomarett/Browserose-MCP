# Tab and frame control — efficient course advancement

This doc briefly explains how the agent manipulates the browser to advance through the IBM ALM / SCORM course **fast and without losing context**.

## Agent behavior: assess, then act

**Do not apply a fixed sequence of steps blindly.** Do **not** look for buttons blindly (e.g. only `list_clickables` or `frame_probe` without looking at the screen). You must **see** what is on screen before deciding what to click.

### Screenshot first

**Always take a screenshot to assess the situation.** Use `browser_screenshot` with the content frame (`frameSelector: "iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame"`) as the **first** step when you need to advance or when you’re unsure of the current state.

From the screenshot, determine:

- **What screen is this?** (quiz intro, question N, feedback after submit, quiz results, lesson content, summary.)
- **What buttons are actually visible?** (e.g. SUBMIT, Next, TAKE AGAIN, Continue.) Do not assume they exist or where they are — look at the image.
- **Is anything off-screen?** (e.g. SUBMIT or the last option below the fold.) If so, scroll in the content frame (e.g. `browser_press_key` PageDown or End), then take **another screenshot** and re-assess before clicking.

Only after you’ve assessed from the screenshot should you choose the next action (which button to click, whether to scroll first, or which sidebar item to use). Use `browser_list_clickables` or `browser_frame_probe` to resolve a locator **after** you’ve seen the screen.

### Earliest unfinished: work in order

**Always find and complete the earliest unfinished page** (from the sidebar). The sidebar lists sections in order; items with a **checkmark** are finished, items with an **empty or partial circle** are not.

- **Identify:** From the screenshot, find the **first** (topmost) sidebar item that is **not** finished — no checkmark. That is your next target.
- **Go to it:** Click that sidebar item to open that page (same content frame).
- **Finish it:**
  - **Section/lesson** (content page): Do what’s needed to get it checkmarked — e.g. scroll through the content, click Next/Continue if visible, or expand/view any required parts. Some sections are marked complete once viewed.
  - **Quiz:** Answer each question (use **quiz_feedback.md** for correct answers), **SUBMIT**, then **NEXT** after feedback; after results, click **Next** to continue.
- **Order matters:** Some sections are **locked** until all **prior** ones are finished (they appear disabled/restricted in the sidebar). You cannot skip ahead; always complete the **earliest** unfinished item first, then re-assess and repeat.

When there are no visible Next/Continue buttons on the current page, **navigate by clicking that earliest unfinished item in the sidebar** (not an arbitrary “next” — the first one without a checkmark).

### Steps

1. **Assess** — **Take a screenshot** of the content frame. From it, identify the current state (lesson, quiz intro, question, feedback, results) and what’s visible (buttons, options, scroll need). **In the sidebar, identify the earliest unfinished item** (first without a checkmark). Add probe/list_clickables only if you need to target something specific.
2. **Decide** — If you’re on a quiz/question/feedback/results screen, use the usual flow (SUBMIT, NEXT, etc.). If you’re on a lesson/summary with no visible Next/Continue, **go to the earliest unfinished sidebar item** and open it to finish it (section → view/scroll to get checkmarked; quiz → answer and submit). If something is off-screen, scroll then take another screenshot.
3. **Act** — Perform one or a few actions (e.g. click that sidebar item, or submit/next on current page), then **re-assess with a new screenshot**. Do not chain many steps without looking at the screen again.

The steps and selectors in this doc are **tools to use after** you’ve identified the state from a screenshot; they are not a script to run line-by-line regardless of what’s visible.

## Browser session: use a large window (agrandi)

Open the Chrome session **agrandi** (maximized or a large window). Using a small window has led to elements (e.g. 4th quiz option, SUBMIT) being off-screen, failed locator clicks, and confusing “intro still visible” states. The window opens **maximized by default**. To use a fixed size instead, set **`PLAYWRIGHT_MCP_VIEWPORT_MAXIMIZED=0`** and optionally **`PLAYWRIGHT_MCP_VIEWPORT_WIDTH`** / **`PLAYWRIGHT_MCP_VIEWPORT_HEIGHT`**. See **README.md**.

## Why this matters

- We need to **advance fast** through lessons and quizzes.
- Using a **fixed frame chain and a small set of actions** avoids forgetting where to click and reduces mistakes.

## Content frame (single source of truth)

All lesson and quiz UI lives in one nested iframe. Use this selector everywhere:

```text
iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame
```

- **Lessons:** Continue / Next = `button.continue-btn` or, if not visible, `browser_click_at_rel` at bottom (e.g. `rx: 0.5`, `ry: 0.9`). **When there are no visible Next/Continue buttons**, go to the **earliest unfinished item in the left sidebar** (first one without a checkmark), click it, and finish that section (view/scroll to get it checkmarked) or quiz (answer and submit). Sections unlock in order; finish all prior ones first.
- **Quizzes:** Quiz screens use buttons with the text **"Submit"** (and "Next", "TAKE AGAIN"). Option clicks, SUBMIT, NEXT, and TAKE AGAIN all use this same `frameSelector`. Use screenshots to confirm which buttons are visible and whether you need to scroll (e.g. PageDown in the content frame) before clicking.

## Quiz flow (two-pass)

1. **Pass 1 (memorize):** For each question, pick any option (e.g. first with `click_at_rel` rx 0.5, ry ~0.48–0.52), click **SUBMIT** (see below), read feedback (screenshot or frame_probe), store correct answer per question in **quiz_feedback.md**, then click **NEXT** (0.65, 0.85).
2. **Pass 2 (pass):** Click **TAKE AGAIN** (see “Entering the quiz” below), then for each question select the correct option from **quiz_feedback.md**, **SUBMIT**, then **NEXT** until the quiz is complete.

### Entering the quiz

The intro shows “START QUIZ” / “TAKE AGAIN”. To actually enter the first question, click **TAKE AGAIN** with **`nth: 1`** (the second match). The first match often does not switch the view; the second is the real control:

- `browser_click_locator` with `text: "TAKE AGAIN"`, `nth: 1`.

## Option selection when locators fail

If `#qmc-X-label` or text locators are covered by overlays, use **`browser_click_at_rel`** in the content frame with fixed bands (tune if layout differs):

- First option: `rx: 0.5`, `ry: ~0.48–0.52`
- Second: `ry: ~0.56–0.6`
- Third: `ry: ~0.62–0.66`
- Fourth: `ry: ~0.68–0.72`

Use **`browser_hit_test_rel`** or **`browser_click_at_rel_debug`** to confirm the target.

### Robust option click when locator and click_at_rel fail

When quiz or in-lesson options don’t respond (e.g. custom components, overlays), use **`browser_evaluate_click_by_text`**: it finds elements by text inside the frame and triggers DOM `.click()`, bypassing visibility/actionability.

- **frameSelector:** same content frame as above.
- **text:** exact option label, e.g. `"Unstructured data"`, `"Structured data"`.
- **match:** `exact` (default) or `contains`.
- **scopeCss:** optional; restrict to main content to avoid sidebar (e.g. `.page-lesson`, `.fr-view`). If omitted, the smallest visible matching element by area is chosen (often the option).
- **nth:** 0-based index when several elements match (default 0).

Example: `browser_evaluate_click_by_text` with `frameSelector: "iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame"`, `text: "Unstructured data"`. Add `scopeCss: ".page-lesson"` if the sidebar has the same text and the wrong element is clicked.

## Popup handler (new tab = player)

Clicking **Go to activity** on the IBM course page opens the SCORM player in a **new tab**. The MCP **popup handler** (see README) attaches to that new tab automatically, so all later tool calls (navigate, click, probe, etc.) run in the **player tab**. No manual tab switching; the agent keeps advancing in the right page.

## Practice quiz — Classifying and Sourcing Data

Correct answers for Pass 2 are in **quiz_feedback.md** (by question theme). Use that file to select the right option; if the text locator is not visible, use **`click_at_rel`** with the option index (1st → ry ~0.52, 2nd → ~0.56, 3rd → ~0.62, 4th → ~0.68). Scroll with **PageDown** in the content frame if the 4th option or SUBMIT is off-screen.

### SUBMIT (preferred and fallback)

Quiz screens have a button with the text **"Submit"**. Use a **screenshot** to see whether SUBMIT (and all options) are in view; if not, **scroll** in the content frame (e.g. `browser_press_key` with key PageDown, or End) then take another screenshot before clicking.

- **Preferred:** `browser_click_locator` with `role: "button"`, `name: "SUBMIT"` (or `text: "SUBMIT"`), `enabledOnly: true` in the content frame. This works when the button is visible/enabled.
- **Fallback:** If the button is off-screen or Playwright reports not visible/disabled, scroll first, then use **`browser_evaluate_click`** with `css: "button.quiz-card__button"`, `nth: 0` (same frame). Restart the MCP after code changes so **browser_evaluate_click** is available.

### NEXT and leaving results

- **After each question (feedback screen):** wait ~2 s, then **NEXT** via `click_at_rel` (0.65, 0.85) in the content frame.
- **After quiz results (100% / pass):** The visible “Next” to continue past the quiz is **not** the disabled `quiz-card__button--next`. Use `browser_click_locator` with `text: "Next"`, **`enabledOnly: true`** so the enabled “Next” is clicked and you advance to the next lesson (e.g. “Summary and looking ahead”).

## Checklist to avoid forgetting

- **Screenshot first:** Before deciding what to click, take a **screenshot** of the content frame and use it to assess the screen (state, visible buttons, need to scroll). Do not rely only on list_clickables or probe without looking at the screen.
- **Earliest unfinished:** Always target the **first sidebar item without a checkmark**. Go to it and finish it (section → view/scroll to checkmark; quiz → answer and submit). Some sections stay locked until prior ones are done.
- **No buttons?** When no Next/Continue/Submit is visible (e.g. on a summary or lesson page), **navigate by clicking that earliest unfinished item in the left sidebar** (same content frame).
- After scrolling, take **another screenshot** to confirm SUBMIT/options/Next are in view before clicking.
- Always pass **`frameSelector: "iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame"`** for lesson/quiz actions.
- **Enter quiz:** Use **TAKE AGAIN** with `nth: 1` to get from intro to Question 1.
- **Correct answers:** See **quiz_feedback.md** (by question theme); use text locator, **`click_at_rel`** ry bands, or **`browser_evaluate_click_by_text`** when options don’t respond.
- Use **`enabledOnly: true`** for SUBMIT (and for “Next” on the quiz results screen).
- **NEXT** after feedback: `click_at_rel` (0.65, 0.85); **Next** after results: `text: "Next"`, `enabledOnly: true`.
- After opening the course from IBM, **wait 5–8 s** then probe the content frame to confirm the player is ready.
- **Crash avoidance:** Wait 4–6 s after every 2–3 actions; use **evaluate_click** in the game iframe; do at most 3–4 questions per run then stop. If crashes persist, use the **manual fallback** in "Avoiding Cursor/browser crashes" to finish "Show what you know!" in a normal browser.

## Avoiding Cursor/browser crashes

Heavy automation (nested iframes, Adobe Rise game, many rapid actions) can trigger Cursor window crashes (e.g. "terminated unexpectedly", code 5). To reduce the risk:

### Do (strict)

- **Longer pauses:** After every **2–3 actions**, **wait 4–6 seconds**. In the game iframe, wait **4–5 s** after each Submit and after each Next before the next action.
- **Tiny batches:** Never do more than **3 tool calls in a row** without a 4–6 s wait. One question = probe → wait 2 s → click option → wait 3 s → Submit → wait 5 s → Next → wait 5 s → (next question).
- **Prefer DOM click in the game iframe:** In "Show what you know!" (Rise game), use **`browser_evaluate_click`** (e.g. `button.acc-button` and `nth`) for Play, Next, Submit. Avoid **`click_locator`** in the game iframe; it often hits overlays and retries stress the renderer.
- **Short runs:** Do **at most 3–4 questions per run**, then **stop and tell the user:** "Stopped after Q4 to reduce crash risk. Say 'continue' to do the next batch." Resume in a new message.
- **Screenshot only when needed:** Screenshot only at decision points (e.g. after opening game, when stuck). No screenshot after every click.

### Avoid

- **No long chains:** Never 8+ tool calls without a 4–6 s wait.
- **No aggressive retries:** If a click fails, try **evaluate_click** once; then continue with evaluate_click for that button type. Do not retry the same failing locator repeatedly.
- **No unnecessary probes:** Probe only when you need the question/options text for the next answer.

### If crashes keep happening: manual fallback

Complete **"Show what you know!"** once by hand so the module can reach 100% without further automation in the game:

1. In Cursor, **don’t** run the browser MCP for the game. Close the automation browser if it’s open.
2. In a **normal browser** (Chrome/Firefox), go to the course and log in: plan URL → Log in with IBM → IBMid → Continue → password → Log in.
3. Accept cookies → **Microcredential 1: Data Classification** → **Classifying and Sourcing Data** → **Go to activity** → **Continue**.
4. In the left sidebar, open **"Show what you know!"** and scroll the main area until you see the game (Play button).
5. Click **Play** → **Next** on the instructions. For each of the **16 questions**: read the scenario, choose **Primary** or **Secondary** / **Quantitative** or **Qualitative** / **Interval** or **Ratio** / **Structured** or **Unstructured** (see answer logic in conversation summary or below), select it, click **Submit**, then **Next**. Need **80%** (e.g. 13/16) to pass.
6. After the last question, the module will update to **100%** and "Show what you know!" will be marked complete.

**Answer logic (game):** Own data for own purpose → Primary; external reports/DB/articles → Secondary. Numbers/counts → Quantitative; opinions/feedback/experiences → Qualitative. Scale with no true zero (e.g. satisfaction 1–10) → Interval; true zero (weight, count) → Ratio. DB/spreadsheet/rows → Structured; social media, multimedia → Unstructured.

### Game iframe selector

For "Show what you know!" the game lives in a fourth-level iframe. Use:

```text
iframe#pplayer_iframe >> iframe#modulePlayerIframe >> iframe#content-frame >> iframe
```

Scroll the content frame (e.g. PageDown) so the game iframe is in view before probing or clicking inside it.

---

## Finish the course (end-to-end)

1. **Browser closed?** Restart the MCP server (or Cursor) so the browser re-launches on next tool use (see `src/browser.ts`: stale page is cleared when closed).
2. **Navigate** to the plan URL (e.g. from **course creds.txt**), then **log in** (Log in with ibm → IBMid → Continue → Password → Log in).
3. **Open the activity:** Plan → Microcredential 1: Data Classification → Classifying and Sourcing Data → **Go to activity** (button). Wait 5–8 s for the player; if a new tab opens, the MCP attaches to it.
4. **In the player:** Click **Continue** if you see the module overview. Then **assess with a screenshot first** (content frame): from the screenshot, identify the state and **the earliest unfinished sidebar item** (first without a checkmark). If you’re on a lesson/quiz screen, use the usual flow (Continue/Next, SUBMIT, NEXT). When there are no buttons, **click that earliest unfinished item** and finish it (section → view/scroll to checkmark; quiz → answer and submit). Sections unlock in order, so always complete the first unfinished before moving on. After each action, take another screenshot and repeat until module completion or no more content.
5. **Quizzes after Lesson 2+:** Use the same pattern (assess → answer from feedback or quiz_feedback if same course, SUBMIT → NEXT → Next on results). Add new correct answers to **quiz_feedback.md** if you encounter new questions.


