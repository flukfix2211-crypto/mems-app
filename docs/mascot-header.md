# Header companion

The mascot emerges from behind a small MEMs logo dock on a reserved rail at the bottom of the header, then walks back and forth continuously on every page. It never crosses the form. Advice occupies a fixed-height slot so its appearance does not move form controls.

Automatic advice runs once per browser-tab session; walking continues afterward. Manual advice and a persistent pause toggle are available. Input focus, scrolling, visible dialogs and page visibility changes suppress speech and temporarily retreat the header companion. Walking resumes after interaction. Reduced motion offers manual text without animation. Hidden pages and paused companions have no animation loop.

The borrow/return receipt has its own reserved 72px canvas above the new-transaction button, using the existing walking sprite continuously. The underlying header companion yields while this receipt is open. Both components request Screen Wake Lock where available and release their own locks on exit/backgrounding. The header also releases on pause. Browser/device policy can deny a wake lock; animation alone cannot guarantee preventing display sleep. Reduced motion stops animation while retaining screen wake protection.

The preparation advice now matches the current add-number workflow.

## Art

`img/mascot/mascot-walk-v2.webp` is a transparent 4-column × 2-row sprite sheet produced with the built-in imagegen tool using the existing MEMs mascot as reference. Existing idle/blink/wave images are retained. No third-party art was added.

Final editing prompt:

> Edit this sprite sheet: remove ALL gray/teal backdrop, glow, haze and shadows. Background between and around robots MUST be truly empty transparent alpha=0. Retain exactly 4 columns x 2 rows, same cell centers and robot scale. Improve walking cycle: top row left leg forward then both knees passing then right leg forward then feet together; bottom row opposite phases. Keep robot design and 8 whole bodies. No background color anywhere, no halo. Clean isolated cutout sprites.

## Validation

- `node --check mascot.js`
- `node --test tests/mascot.test.js tests/receipt-mascot.test.js`: continuous walking over multiple cycles, welcome frequency, modal/input suppression and automatic restart, pause persistence, reduced motion, receipt wake-lock lifecycle and pending-request cleanup.
- `node --test tests/mascot-browser.cjs`: browser layout and integration test, requires Playwright Chromium. Not run successfully in the authoring environment: Chromium download returned an invalid ZIP. Visual review on an actual mobile browser remains necessary before merge.

The generated frame sequence is a first animation pass. Its perceived smoothness and transition to the existing wave pose still require visual review.
