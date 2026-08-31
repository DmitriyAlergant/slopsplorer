import { writeFile } from "node:fs/promises";

const [debuggingEndpoint, pageUrl, outputPath] = process.argv.slice(2);
if (debuggingEndpoint === undefined || pageUrl === undefined || outputPath === undefined) {
  throw new Error("usage: capture-pr-diff-image.mjs <debugging-endpoint> <page-url> <output-path>");
}

const deadline = Date.now() + 20_000;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findPageTarget() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${debuggingEndpoint}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((candidate) => candidate.type === "page" && candidate.url === pageUrl);
        if (target !== undefined) return target;
      }
    } catch {
      // Chrome may not have opened its debugging listener yet.
    }
    await delay(100);
  }
  throw new Error(`Chrome did not open ${pageUrl}`);
}

const target = await findPageTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const response = JSON.parse(event.data);
  if (response.id === undefined) return;
  const held = pending.get(response.id);
  if (held === undefined) return;
  pending.delete(response.id);
  if (response.error !== undefined) held.reject(new Error(response.error.message));
  else held.resolve(response.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("Chrome rejected the debugging connection")), { once: true });
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  let lastState = null;
  while (Date.now() < deadline) {
    const evaluation = await command("Runtime.evaluate", {
      expression: `(() => ({
        ready: document.title.endsWith(" - Slopsplorer diff")
          && document.querySelector(".spine--pending") === null,
        error: document.querySelector(".app--error")?.textContent?.trim() ?? null,
        title: document.title,
        text: document.body.innerText.slice(0, 1000),
      }))()`,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails !== undefined) {
      throw new Error(evaluation.exceptionDetails.text);
    }
    lastState = evaluation.result.value;
    if (lastState.error !== null) throw new Error(lastState.error);
    if (lastState.ready === true) break;
    await delay(100);
  }
  if (lastState?.ready !== true) {
    throw new Error(`the diff view did not become ready: ${JSON.stringify(lastState)}`);
  }
  await command("Runtime.evaluate", {
    expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    awaitPromise: true,
  });
  const layout = await command("Page.getLayoutMetrics");
  const contentHeight = Math.ceil(layout.cssContentSize.height);
  if (contentHeight < 900 || contentHeight > 4096) {
    throw new Error(`the rendered page height is outside the accepted range: ${contentHeight}`);
  }
  const capture = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: contentHeight, scale: 1 },
  });
  await writeFile(outputPath, Buffer.from(capture.data, "base64"));
} finally {
  socket.close();
}
