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

let ws;
let sessionId = null;
let running = false;

function log(message) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.textContent = `[${time}] ${message}`;
  logEl.prepend(entry);
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
        progressText.textContent = `queued job ${data.jobId}`;
        break;
      case "progress":
        progressText.textContent = `progress: ${data.value ?? 0} / ${data.max ?? 0}`;
        break;
      case "image":
        imageEl.hidden = false;
        imageEl.src = data.dataUrl;
        log(`iteration complete with prompt: "${data.prompt}"`);
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
  const dataUrl = await readFileAsBase64(file);
  const [header, base64] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/data:(.*);base64/);
  const mimeType = mimeMatch?.[1] || file.type || "image/png";

  sendWhenReady({
    type: "start",
    prompt: promptInput.value.trim(),
    image: base64,
    mimeType
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

promptInput.addEventListener("change", () => {
  const prompt = promptInput.value.trim();
  sendWhenReady({ type: "update_prompt", prompt });
});

ensureConnection();
