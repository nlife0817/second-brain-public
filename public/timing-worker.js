/**
 * Timing tick worker.
 *
 * Lives in a Web Worker so its setInterval is not throttled by Chrome's
 * "intensive throttling" of background tabs (which can drop main-thread
 * setInterval to once per minute).
 *
 * Messages:
 *   main -> worker: { type: 'start', tickMs?: 1000, sleepThresholdMs?: 30000 }
 *   main -> worker: { type: 'stop' }
 *   worker -> main: { type: 'tick', now }
 *   worker -> main: { type: 'sleep_detected', drift, now }
 *
 * Source-of-truth for elapsed time stays Date.now() - started_at on the main
 * thread; this worker only nudges the UI to re-render and fires sleep events.
 */

let timer = null;
let expectedNext = 0;
let tickMs = 1000;
let sleepThresholdMs = 30_000;

function loop() {
  const now = Date.now();
  const drift = now - expectedNext;
  if (drift > sleepThresholdMs) {
    self.postMessage({ type: "sleep_detected", drift, now });
  }
  self.postMessage({ type: "tick", now });
  expectedNext = now + tickMs;
  timer = setTimeout(loop, tickMs);
}

self.addEventListener("message", (ev) => {
  const data = ev.data || {};
  if (data.type === "start") {
    if (typeof data.tickMs === "number" && data.tickMs > 0) tickMs = data.tickMs;
    if (typeof data.sleepThresholdMs === "number" && data.sleepThresholdMs > 0) {
      sleepThresholdMs = data.sleepThresholdMs;
    }
    if (timer) clearTimeout(timer);
    expectedNext = Date.now() + tickMs;
    timer = setTimeout(loop, tickMs);
  } else if (data.type === "stop") {
    if (timer) clearTimeout(timer);
    timer = null;
  }
});
