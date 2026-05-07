import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getDatabase,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  serverTimestamp,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const commandDefinitions = [
  {
    name: "gate.access",
    value: "allow",
    label: "Dozvoli prolaz",
    description: "gate.access / allow",
    icon: "shield-check",
    tone: "success"
  },
  {
    name: "gate.access",
    value: "deny",
    label: "Zabrani prolaz",
    description: "gate.access / deny",
    icon: "shield-x",
    tone: "danger"
  },
  {
    name: "gate.position",
    value: "open",
    label: "Otvori rampu",
    description: "gate.position / open",
    icon: "arrow-up-to-line",
    tone: "info"
  },
  {
    name: "gate.position",
    value: "close",
    label: "Zatvori rampu",
    description: "gate.position / close",
    icon: "arrow-down-to-line",
    tone: "warn"
  },
  {
    name: "buzzer.enabled",
    value: true,
    label: "Buzzer ON",
    description: "buzzer.enabled / true",
    icon: "volume-2",
    tone: "info"
  },
  {
    name: "buzzer.enabled",
    value: false,
    label: "Buzzer OFF",
    description: "buzzer.enabled / false",
    icon: "volume-x",
    tone: "warn"
  },
  {
    name: "mode",
    value: "auto",
    label: "Auto rezim",
    description: "mode / auto",
    icon: "rotate-cw",
    tone: "success"
  },
  {
    name: "mode",
    value: "manual",
    label: "Manual rezim",
    description: "mode / manual",
    icon: "hand",
    tone: "info"
  },
  {
    name: "state.publish",
    value: "now",
    label: "Objavi stanje",
    description: "state.publish / now",
    icon: "send",
    tone: "info"
  }
];

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  deviceIdInput: document.querySelector("#deviceIdInput"),
  connectButton: document.querySelector("#connectButton"),
  refreshStateButton: document.querySelector("#refreshStateButton"),
  commandGrid: document.querySelector("#commandGrid"),
  commandLog: document.querySelector("#commandLog"),
  gateState: document.querySelector("#gateState"),
  carState: document.querySelector("#carState"),
  distanceState: document.querySelector("#distanceState"),
  modeState: document.querySelector("#modeState"),
  buzzerState: document.querySelector("#buzzerState"),
  lastUpdate: document.querySelector("#lastUpdate"),
  lastCommandName: document.querySelector("#lastCommandName"),
  lastCommandValue: document.querySelector("#lastCommandValue"),
  configForm: document.querySelector("#configForm"),
  displayNameInput: document.querySelector("#displayNameInput"),
  detectionDistanceInput: document.querySelector("#detectionDistanceInput"),
  gateOpenMsInput: document.querySelector("#gateOpenMsInput"),
  buzzerEnabledInput: document.querySelector("#buzzerEnabledInput"),
  modeInput: document.querySelector("#modeInput")
};

let app;
let db;
let activeDeviceId = elements.deviceIdInput.value.trim();
let activeUnsubscribers = [];

function hasFirebaseConfig() {
  const requiredKeys = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  return requiredKeys.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 0 && !value.includes("YOUR_");
  });
}

function setConnectionStatus(message, state = "warning") {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.remove("is-online", "is-warning", "is-error");
  elements.connectionStatus.classList.add(`is-${state}`);
}

function devicePath(childPath = "") {
  const basePath = `devices/${activeDeviceId}`;
  return childPath ? `${basePath}/${childPath}` : basePath;
}

function formatValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return String(value);
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Nema timestamp";
  }

  if (typeof timestamp !== "number") {
    return "Timestamp u obradi";
  }

  return new Intl.DateTimeFormat("sr-RS", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(timestamp));
}

function iconMarkup(icon) {
  return `<i data-lucide="${icon}" aria-hidden="true"></i>`;
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderCommandButtons() {
  elements.commandGrid.innerHTML = commandDefinitions
    .map((command, index) => `
      <button class="command-button" data-command-index="${index}" data-tone="${command.tone}" type="button" ${db ? "" : "disabled"}>
        <span>${iconMarkup(command.icon)}${command.label}</span>
        <small>${command.description}</small>
      </button>
    `)
    .join("");

  elements.commandGrid.querySelectorAll("[data-command-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = commandDefinitions[Number(button.dataset.commandIndex)];
      sendCommand(command);
    });
  });

  refreshIcons();
}

async function sendCommand(command) {
  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  try {
    const commandRef = push(ref(db, devicePath("commands")));
    await set(commandRef, {
      name: command.name,
      value: command.value,
      timestamp: serverTimestamp(),
      source: "web",
      requestId: crypto.randomUUID ? crypto.randomUUID() : commandRef.key
    });

    setConnectionStatus(`Poslato: ${command.name}`, "online");
  } catch (error) {
    console.error(error);
    setConnectionStatus("Slanje nije uspelo", "error");
  }
}

function renderState(state) {
  if (!state) {
    elements.gateState.textContent = "--";
    elements.carState.textContent = "--";
    elements.distanceState.textContent = "Udaljenost: --";
    elements.modeState.textContent = "--";
    elements.buzzerState.textContent = "Buzzer: --";
    elements.lastUpdate.textContent = "Nema stanja za ovaj uredjaj";
    elements.lastCommandName.textContent = "--";
    elements.lastCommandValue.textContent = "--";
    return;
  }

  elements.gateState.textContent = state.gate === "open" ? "Otvorena" : "Spustena";
  elements.carState.textContent = state.carPresent ? "Detektovan" : "Nema auta";
  elements.distanceState.textContent = `Udaljenost: ${state.distanceCm >= 0 ? `${Number(state.distanceCm).toFixed(1)} cm` : "--"}`;
  elements.modeState.textContent = formatValue(state.mode);
  elements.buzzerState.textContent = `Buzzer: ${state.buzzerEnabled ? "ON" : "OFF"}`;
  elements.lastUpdate.textContent = `Azurirano: ${formatTimestamp(state.updatedAt)}`;

  const lastCommand = state.lastProcessedCommand || {};
  elements.lastCommandName.textContent = formatValue(lastCommand.name);
  elements.lastCommandValue.textContent = `${formatValue(lastCommand.value)} / ${formatValue(lastCommand.source)}`;
}

function renderConfig(config) {
  if (!config) {
    return;
  }

  if (config.displayName) {
    elements.displayNameInput.value = config.displayName;
  }

  if (config.detectionDistanceCm) {
    elements.detectionDistanceInput.value = config.detectionDistanceCm;
  }

  if (config.gateOpenMs) {
    elements.gateOpenMsInput.value = config.gateOpenMs;
  }

  if (typeof config.buzzerEnabled === "boolean") {
    elements.buzzerEnabledInput.checked = config.buzzerEnabled;
  }

  if (config.mode) {
    elements.modeInput.value = config.mode;
  }
}

function renderCommandLog(commands) {
  if (!commands || commands.length === 0) {
    elements.commandLog.innerHTML = `<div class="empty-state">Jos nema komandi.</div>`;
    return;
  }

  elements.commandLog.innerHTML = commands
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .map((command) => `
      <div class="log-row">
        <strong>${formatValue(command.name)}</strong>
        <span>${formatValue(command.value)}</span>
        <span>${formatTimestamp(command.timestamp)}</span>
      </div>
    `)
    .join("");
}

function detachListeners() {
  activeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  activeUnsubscribers = [];
}

function listen(refObject, callback) {
  activeUnsubscribers.push(onValue(refObject, callback));
}

function connectToDevice() {
  if (!db) {
    return;
  }

  const nextDeviceId = elements.deviceIdInput.value.trim();
  if (!nextDeviceId) {
    setConnectionStatus("Device ID je obavezan", "error");
    return;
  }

  activeDeviceId = nextDeviceId;
  detachListeners();

  const stateRef = ref(db, devicePath("state"));
  const configRef = ref(db, devicePath("config"));
  const commandsRef = query(ref(db, devicePath("commands")), orderByChild("timestamp"), limitToLast(10));
  const connectedRef = ref(db, ".info/connected");

  listen(stateRef, (snapshot) => renderState(snapshot.val()));
  listen(configRef, (snapshot) => renderConfig(snapshot.val()));
  listen(commandsRef, (snapshot) => {
    const value = snapshot.val();
    const commands = value ? Object.entries(value).map(([id, command]) => ({ id, ...command })) : [];
    renderCommandLog(commands);
  });
  listen(connectedRef, (snapshot) => {
    setConnectionStatus(snapshot.val() ? `Povezano: ${activeDeviceId}` : "Offline", snapshot.val() ? "online" : "warning");
  });
}

async function saveConfig(event) {
  event.preventDefault();

  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  const detectionDistanceCm = Number(elements.detectionDistanceInput.value);
  const gateOpenMs = Number(elements.gateOpenMsInput.value);

  try {
    await update(ref(db, devicePath("config")), {
      displayName: elements.displayNameInput.value.trim() || activeDeviceId,
      detectionDistanceCm,
      gateOpenMs,
      buzzerEnabled: elements.buzzerEnabledInput.checked,
      mode: elements.modeInput.value,
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });

    setConnectionStatus("Config sacuvan", "online");
  } catch (error) {
    console.error(error);
    setConnectionStatus("Config nije sacuvan", "error");
  }
}

function init() {
  renderCommandButtons();

  elements.connectButton.addEventListener("click", connectToDevice);
  elements.configForm.addEventListener("submit", saveConfig);
  elements.refreshStateButton.addEventListener("click", () => {
    sendCommand({ name: "state.publish", value: "now" });
  });

  if (!hasFirebaseConfig()) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    renderCommandButtons();
    connectToDevice();
  } catch (error) {
    console.error(error);
    setConnectionStatus("Firebase greska", "error");
  }
}

init();
