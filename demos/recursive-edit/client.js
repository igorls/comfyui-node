const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const progressText = document.getElementById("progress-text");
const logEl = document.getElementById("log");
const imageEl = document.getElementById("current-image");
const promptInput = document.getElementById("prompt-input");
const imageInput = document.getElementById("image-input");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resumeBtn = document.getElementById("resume-btn");
const clearLogBtn = document.getElementById("clear-log");
const filmstripEl = document.getElementById("filmstrip");
const statsSummaryEl = document.getElementById("stats-summary");
const statsTableEl = document.getElementById("stats-table");
const kpiThroughputEl = document.getElementById("kpi-throughput");
const kpiWaitingEl = document.getElementById("kpi-waiting");
const kpiRunningEl = document.getElementById("kpi-running");
const kpiCompletedEl = document.getElementById("kpi-completed");
const kpiFailedEl = document.getElementById("kpi-failed");

let ws;
let sessionId = null;
let running = false;
const filmstripImages = [];
const FILMSTRIP_MAX_ITEMS = 28;
let selectedImageDataUrl = null;
let selectedImageMimeType = "image/png";
const completedTimestamps = [];
function pushCompletedNow() {
  const now = Date.now();
  completedTimestamps.push(now);
  const cutoff = now - 60_000;
  while (completedTimestamps.length && completedTimestamps[0] < cutoff) {
    completedTimestamps.shift();
  }
}
function computeThroughput() {
  const now = Date.now();
  const cutoff = now - 60_000;
  let i = 0;
  while (i < completedTimestamps.length && completedTimestamps[i] < cutoff) i++;
  if (i > 0) completedTimestamps.splice(0, i);
  return completedTimestamps.length;
}
function updateKpisFromStats(hosts, queue) {
  const queueWaiting = queue?.waiting != null ? Number(queue.waiting) : 0;
  const totalRunning = (hosts || []).reduce((acc, h) => acc + (Number(h.running) || 0), 0);
  const totalCompleted = (hosts || []).reduce((acc, h) => acc + (Number(h.completed) || 0), 0);
  const totalFailed = (hosts || []).reduce((acc, h) => acc + (Number(h.failed) || 0), 0);
  if (kpiWaitingEl) kpiWaitingEl.textContent = queueWaiting.toLocaleString();
  if (kpiRunningEl) kpiRunningEl.textContent = totalRunning.toLocaleString();
  if (kpiCompletedEl) kpiCompletedEl.textContent = totalCompleted.toLocaleString();
  if (kpiFailedEl) kpiFailedEl.textContent = totalFailed.toLocaleString();
  const tp = computeThroughput();
  if (kpiThroughputEl) kpiThroughputEl.textContent = `${tp.toFixed(1)}/min`;
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.textContent = `[${time}] ${message}`;
  logEl.prepend(entry);
  while (logEl.childElementCount > 200) {
    logEl.removeChild(logEl.lastElementChild);
  }
  logEl.scrollTop = 0;
}

function clearFilmstrip() {
  filmstripImages.length = 0;
  if (filmstripEl) {
    filmstripEl.textContent = "";
  }
}

function addFilmstripImage(dataUrl, jobId, prompt, seed) {
  if (!filmstripEl) return;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "filmstrip-item";
  const titleBase = jobId === "initial" ? "Initial image" : `Job ${jobId}`;
  const seedSuffix = seed != null ? ` (seed ${seed})` : "";
  item.title = prompt ? `${titleBase}${seedSuffix} — ${prompt}` : `${titleBase}${seedSuffix}`;

  const img = document.createElement("img");
  img.src = dataUrl;
  if (jobId === "initial") {
    img.alt = "Initial image selection";
  } else {
    img.alt = prompt ? `Result for prompt: ${prompt}` : "Workflow result";
  }
  item.appendChild(img);

  item.addEventListener("click", () => {
    imageEl.hidden = false;
    imageEl.src = dataUrl;
  });

  filmstripEl.prepend(item);
  filmstripImages.unshift(item);

  while (filmstripImages.length > FILMSTRIP_MAX_ITEMS) {
    const last = filmstripImages.pop();
    last?.remove();
  }
}

function formatHostLabel(url) {
  if (!url) return "Unknown";
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return url;
  }
}

function formatMs(value) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 10000) return `${Math.round(value / 1000)}s`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatPair(avg, last) {
  const avgText = formatMs(avg);
  const lastText = formatMs(last);
  if (last == null || lastText === "—") return avgText;
  return `${avgText} · ${lastText}`;
}

function renderStats(hosts, queue) {
  if (!statsTableEl) return;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    statsTableEl.innerHTML = '<p class="stats-empty">Waiting for activity…</p>';
    statsTableEl.setAttribute("aria-busy", "false");
    if (statsSummaryEl) {
      statsSummaryEl.textContent = "Waiting for activity…";
    }
    return;
  }

  const queueWaiting = queue?.waiting != null ? Number(queue.waiting) : 0;
  const queueActive = queue?.active != null ? Number(queue.active) : null;
  const totalRunning = hosts.reduce((acc, host) => acc + (Number(host.running) || 0), 0);
  const totalCompleted = hosts.reduce((acc, host) => acc + (Number(host.completed) || 0), 0);
  const totalFailed = hosts.reduce((acc, host) => acc + (Number(host.failed) || 0), 0);
  if (statsSummaryEl) {
    const pieces = [`queue ${queueWaiting}`];
    if (queueActive != null) {
      pieces.push(`running ${queueActive}`);
    } else {
      pieces.push(`running ${totalRunning}`);
    }
    pieces.push(`completed ${totalCompleted}`);
    pieces.push(`failed ${totalFailed}`);
    statsSummaryEl.textContent = pieces.join(" · ");
  }

  const rows = hosts
    .map((host) => {
      const running = Number(host.running) || 0;
      const completed = Number(host.completed) || 0;
      const failed = Number(host.failed) || 0;
      const dispatched = Number(host.dispatched) || completed + failed + running;
      const utilisation = dispatched ? Math.round((completed / dispatched) * 100) : 0;
      const waitCell = formatPair(host.avgQueueMs, host.lastQueueMs);
      const runCell = formatPair(host.avgRunMs, host.lastRunMs);
      return `
        <tr>
          <td>${formatHostLabel(host.host)}</td>
          <td>${running}</td>
          <td>${completed}</td>
          <td>${failed}</td>
          <td>${waitCell}</td>
          <td>${runCell}</td>
          <td>${dispatched ? `${utilisation}%` : "—"}</td>
        </tr>
      `;
    })
    .join("");

  const queueRow = queue
    ? `<tr>
          <td colspan="7">Queue waiting: ${queueWaiting}${queueActive != null ? ` · running: ${queueActive}` : ""}</td>
        </tr>`
    : "";

  statsTableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Host</th>
          <th>Active</th>
          <th>Done</th>
          <th>Fail</th>
          <th>Wait avg · last</th>
          <th>Run avg · last</th>
          <th>Success</th>
        </tr>
      </thead>
      <tbody>${rows}${queueRow}</tbody>
    </table>
  `;
  statsTableEl.setAttribute("aria-busy", "false");
}

function setStatus(state, text) {
  statusDot.classList.remove("paused", "error");
  if (state === "paused") statusDot.classList.add("paused");
  if (state === "error") statusDot.classList.add("error");
  statusText.textContent = text;
}

function setRunning(value) {
  running = value;
  startBtn.disabled = value;
  pauseBtn.disabled = !value;
  resumeBtn.disabled = value;
  setStatus(value ? "running" : "paused", value ? "Running" : "Idle");
}

function ensureConnection() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}`);

  ws.addEventListener("open", () => {
    log("WebSocket connected");
  });

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case "ready":
        sessionId = data.sessionId;
        log(`Session ready (${sessionId})`);
        break;
      case "queued":
        if (typeof data.seed === "number") {
          progressText.textContent = `queued job ${data.jobId} (seed ${data.seed})`;
          log(`queued job ${data.jobId} with seed ${data.seed}`);
        } else {
          progressText.textContent = `queued job ${data.jobId}`;
          log(`queued job ${data.jobId}`);
        }
        break;
      case "progress":
        progressText.textContent = `progress: ${data.value ?? 0} / ${data.max ?? 0}`;
        break;
      case "image_preview":
        imageEl.hidden = false;
        imageEl.src = data.dataUrl;
        log(`preview for job ${data.jobId}`);
        break;
      case "image":
        imageEl.hidden = false;
        imageEl.src = data.dataUrl;
        if (typeof data.seed === "number") {
          log(`iteration complete (seed ${data.seed}) with prompt: "${data.prompt}"`);
        } else {
          log(`iteration complete with prompt: "${data.prompt}"`);
        }
        addFilmstripImage(data.dataUrl, data.jobId, data.prompt, data.seed);
        pushCompletedNow();
        updateKpisFromStats([], null);
        break;
      case "prompt":
        log(`prompt updated: ${data.prompt}`);
        break;
      case "state":
        const paused = Boolean(data.paused);
        running = !paused;
        setStatus(paused ? "paused" : "running", paused ? "Paused" : "Running");
        startBtn.disabled = running;
        pauseBtn.disabled = paused;
        resumeBtn.disabled = !paused;
        break;
      case "stats":
        renderStats(data.hosts || [], data.queue || null);
        updateKpisFromStats(data.hosts || [], data.queue || null);
        break;
      case "error":
        setStatus("error", `Error: ${data.message}`);
        log(`error: ${data.message}`);
        if (data.detail) log(JSON.stringify(data.detail));
        break;
      default:
        log(`unknown message ${data.type}`);
    }
  });

  ws.addEventListener("close", () => {
    log("WebSocket closed; retrying in 1s");
    setRunning(false);
    setTimeout(ensureConnection, 1000);
  });
}

function sendWhenReady(payload) {
  const serialized = JSON.stringify(payload);
  if (!ws) {
    ensureConnection();
  }
  const socket = ws;
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serialized);
    return;
  }
  const handler = () => {
    socket.send(serialized);
  };
  socket.addEventListener("open", handler, { once: true });
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!result) {
        reject(new Error("Failed to read file"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

startBtn.addEventListener("click", async () => {
  ensureConnection();
  if (!imageInput.files || imageInput.files.length === 0) {
    log("please select an image first");
    return;
  }
  const file = imageInput.files[0];
  if (!selectedImageDataUrl) {
    selectedImageDataUrl = await readFileAsBase64(file);
    const [selHeader] = selectedImageDataUrl.split(",", 2);
    const mimeMatchInitial = selHeader.match(/data:(.*);base64/);
    selectedImageMimeType = mimeMatchInitial?.[1] || file.type || "image/png";
  }

  const [, base64] = selectedImageDataUrl.split(",", 2);
  if (!base64) {
    log("error: could not decode selected image");
    return;
  }

  clearFilmstrip();
  addFilmstripImage(selectedImageDataUrl, "initial", promptInput.value.trim());
  imageEl.hidden = false;
  imageEl.src = selectedImageDataUrl;

  sendWhenReady({
    type: "start",
    prompt: promptInput.value.trim(),
    image: base64,
    mimeType: selectedImageMimeType
  });
  setRunning(true);
});

pauseBtn.addEventListener("click", () => {
  if (!ws) return;
  sendWhenReady({ type: "pause" });
  setRunning(false);
});

resumeBtn.addEventListener("click", () => {
  ensureConnection();
  sendWhenReady({ type: "resume" });
  setRunning(true);
});

clearLogBtn?.addEventListener("click", () => {
  logEl.textContent = "";
});

promptInput.addEventListener("change", () => {
  const prompt = promptInput.value.trim();
  sendWhenReady({ type: "update_prompt", prompt });
});

imageInput.addEventListener("change", async () => {
  if (!imageInput.files || imageInput.files.length === 0) {
    selectedImageDataUrl = null;
    return;
  }
  const file = imageInput.files[0];
  try {
    selectedImageDataUrl = await readFileAsBase64(file);
    const [header] = selectedImageDataUrl.split(",", 2);
    const mimeMatch = header.match(/data:(.*);base64/);
    selectedImageMimeType = mimeMatch?.[1] || file.type || "image/png";

    imageEl.hidden = false;
    imageEl.src = selectedImageDataUrl;
    log(`loaded initial image: ${file.name}`);

    clearFilmstrip();
    addFilmstripImage(selectedImageDataUrl, "initial", promptInput.value.trim());
  } catch (error) {
    log(`error: ${(error instanceof Error ? error.message : String(error))}`);
  }
});

renderStats([], null);
ensureConnection();
