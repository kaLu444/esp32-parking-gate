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
  startAt,
  update
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const commandDefinitions = [
  {
    id: "allowAccess",
    name: "gate.access",
    value: "allow",
    label: "Dozvoli pristup",
    icon: "arrow-up",
    tone: "success",
    requiresVehicle: true
  },
  {
    id: "denyAccess",
    name: "gate.access",
    value: "deny",
    label: "Zabrani pristup",
    icon: "hand",
    tone: "danger",
    requiresVehicle: true
  },
  {
    id: "toggleGate",
    name: "gate.position",
    value: "toggle",
    label: "Otvori rampu",
    icon: "clock",
    tone: "primary"
  }
];

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionMetric: document.querySelector("#connectionMetric"),
  connectionDetail: document.querySelector("#connectionDetail"),
  sceneConnection: document.querySelector("#sceneConnection"),
  deviceIdInput: document.querySelector("#deviceIdInput"),
  connectButton: document.querySelector("#connectButton"),
  commandGrid: document.querySelector("#commandGrid"),
  commandLog: document.querySelector("#commandLog"),
  allCommandLog: document.querySelector("#allCommandLog"),
  toggleActivitiesButton: document.querySelector("#toggleActivitiesButton"),
  activitiesModal: document.querySelector("#activitiesModal"),
  closeActivitiesModal: document.querySelector("#closeActivitiesModal"),
  activityCard: document.querySelector(".activity-card"),
  gateState: document.querySelector("#gateState"),
  gateSubtitle: document.querySelector("#gateSubtitle"),
  gateStatusOrb: document.querySelector("#gateStatusOrb"),
  gateArm: document.querySelector("#gateArm"),
  carShape: document.querySelector("#carShape"),
  vehicleTitle: document.querySelector("#vehicleTitle"),
  vehicleSubtitle: document.querySelector("#vehicleSubtitle"),
  distanceValue: document.querySelector("#distanceValue"),
  distanceMeta: document.querySelector("#distanceMeta"),
  buzzerState: document.querySelector("#buzzerState"),
  lastUpdate: document.querySelector("#lastUpdate"),
  lastCommandValue: document.querySelector("#lastCommandValue"),
  todayCommandCount: document.querySelector("#todayCommandCount"),
  configForm: document.querySelector("#configForm"),
  detectionDistanceInput: document.querySelector("#detectionDistanceInput"),
  gateOpenMsInput: document.querySelector("#gateOpenMsInput"),
  buzzerEnabledInput: document.querySelector("#buzzerEnabledInput")
};

let app;
let db;
let activeDeviceId = elements.deviceIdInput.value.trim();
let activeUnsubscribers = [];
let recentCommands = [];
let latestState = null;
let currentGateOpen = false;
let currentHasVehicle = false;

const ESP_ONLINE_STALE_MS = 8000;

function hasFirebaseConfig() {
  const requiredKeys = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  return requiredKeys.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 0 && !value.includes("YOUR_");
  });
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setConnectionStatus(message, state = "warning") {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.remove("is-online", "is-warning", "is-error");
  elements.connectionStatus.classList.add(`is-${state}`);
}

function isEspStateFresh(state) {
  return typeof state?.updatedAt === "number" && Date.now() - state.updatedAt <= ESP_ONLINE_STALE_MS;
}

function isEspOnline(state) {
  return Boolean(state?.online) && isEspStateFresh(state);
}

function renderEspConnection(state) {
  const online = isEspOnline(state);
  const hasState = Boolean(state);

  setConnectionStatus(online ? "ESP32 online" : "ESP32 offline", online ? "online" : "warning");
  elements.sceneConnection.textContent = online ? "Online veza" : "Offline";
  elements.sceneConnection.classList.toggle("is-online", online);
  elements.connectionMetric.textContent = online ? "Online" : "Offline";
  elements.connectionDetail.textContent = online
    ? "ESP32 salje stanje"
    : hasState
      ? `Zadnje stanje: ${formatClock(state.updatedAt)}`
      : "Ceka se ESP32";
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

function formatClock(timestamp) {
  if (typeof timestamp !== "number") {
    return "--";
  }

  return new Intl.DateTimeFormat("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

function isToday(timestamp) {
  if (typeof timestamp !== "number") {
    return false;
  }

  const date = new Date(timestamp);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function getDayStartTimestamp() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getDistanceText(distanceCm) {
  if (typeof distanceCm !== "number" || distanceCm < 0) {
    return "--";
  }

  return String(Math.round(distanceCm));
}

function clampNumber(value, fallback, min, max) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    return fallback;
  }

  return numberValue;
}

function getGateOpenMs() {
  return clampNumber(elements.gateOpenMsInput.value, 4000, 1000, 30000);
}

function getCommandPresentation(command) {
  const name = command.name;
  const value = command.value;

  if (name === "gate.access" && value === "allow") {
    return { title: "Prolaz dozvoljen", subtitle: "Operator", icon: "check", tone: "success" };
  }

  if (name === "gate.access" && value === "deny") {
    return { title: "Zabranjen prolaz", subtitle: "Vratite se", icon: "hand", tone: "danger" };
  }

  if (name === "gate.position" && value === "open") {
    return { title: "Rampa otvorena", subtitle: "Operator", icon: "arrow-up", tone: "primary" };
  }

  if (name === "gate.position" && value === "close") {
    return { title: "Rampa zatvorena", subtitle: "Operator", icon: "arrow-down", tone: "info" };
  }

  if (name === "state.publish") {
    return { title: "Objavljeno stanje", subtitle: "ESP32", icon: "send", tone: "info" };
  }

  return {
    title: formatValue(name),
    subtitle: formatValue(value),
    icon: "activity",
    tone: "info"
  };
}

function resolveCommand(command) {
  if (command.id !== "toggleGate") {
    return command;
  }

  const shouldClose = currentGateOpen;
  return {
    ...command,
    value: shouldClose ? "close" : "open",
    label: shouldClose ? "Zatvori rampu" : "Otvori rampu",
    icon: shouldClose ? "arrow-down" : "arrow-up"
  };
}

function canUseCommand(command) {
  if (!db) {
    return false;
  }

  return !command.requiresVehicle || currentHasVehicle;
}

function renderCommandButtons() {
  elements.commandGrid.innerHTML = commandDefinitions
    .map((baseCommand, index) => {
      const command = resolveCommand(baseCommand);
      const disabled = canUseCommand(baseCommand) ? "" : "disabled";
      const title = baseCommand.requiresVehicle && !currentHasVehicle ? "Dostupno kada senzor detektuje vozilo" : "";

      return `
      <button class="action-button" data-command-index="${index}" data-tone="${command.tone}" type="button" title="${title}" ${disabled}>
        <span class="action-icon"><i data-lucide="${command.icon}" aria-hidden="true"></i></span>
        <strong>${command.label}</strong>
      </button>
    `;
    })
    .join("");

  elements.commandGrid.querySelectorAll("[data-command-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = resolveCommand(commandDefinitions[Number(button.dataset.commandIndex)]);
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

  if (command.requiresVehicle && !currentHasVehicle) {
    return;
  }

  try {
    const commandRef = push(ref(db, devicePath("commands")));
    const payload = {
      name: command.name,
      value: command.value,
      timestamp: serverTimestamp(),
      source: "web",
      requestId: crypto.randomUUID ? crypto.randomUUID() : commandRef.key
    };

    if (command.includeDuration) {
      payload.durationMs = getGateOpenMs();
    }

    await set(commandRef, payload);
  } catch (error) {
    console.error(error);
    setConnectionStatus("Slanje nije uspelo", "error");
  }
}

function renderState(state) {
  latestState = state;

  if (!state) {
    currentGateOpen = false;
    currentHasVehicle = false;
    elements.gateState.textContent = "--";
    elements.gateState.classList.remove("is-open");
    elements.gateSubtitle.textContent = "Nema podataka";
    elements.gateStatusOrb.classList.remove("is-open");
    elements.gateArm.classList.remove("is-open");
    elements.vehicleTitle.textContent = "Nema vozila";
    elements.vehicleSubtitle.textContent = "Ceka se senzor udaljenosti";
    elements.carShape.classList.add("is-hidden");
    elements.distanceValue.textContent = "--";
    elements.distanceMeta.textContent = "Udaljenost: --";
    elements.buzzerState.textContent = "--";
    elements.lastUpdate.textContent = "--";
    elements.lastCommandValue.textContent = "--";
    renderEspConnection(null);
    renderCommandButtons();
    refreshIcons();
    return;
  }

  const gateValue = state.gate || state.gatePosition || state.position;
  const isGateOpen = gateValue === "open" || gateValue === true;
  const distanceText = getDistanceText(state.distanceCm);
  const hasVehicle = typeof state.carPresent === "boolean"
    ? state.carPresent
    : typeof state.distanceCm === "number" && state.distanceCm > 0;

  currentGateOpen = isGateOpen;
  currentHasVehicle = hasVehicle;
  elements.gateState.textContent = isGateOpen ? "Otvorena" : "Zatvorena";
  elements.gateState.classList.toggle("is-open", isGateOpen);
  elements.gateSubtitle.textContent = isGateOpen ? "Rampa je podignuta" : "Rampa je spustena";
  elements.gateStatusOrb.classList.toggle("is-open", isGateOpen);
  elements.gateStatusOrb.innerHTML = `<i data-lucide="${isGateOpen ? "door-open" : "door-closed"}"></i>`;
  elements.gateArm.classList.toggle("is-open", isGateOpen);
  elements.vehicleTitle.textContent = hasVehicle ? "Vozilo detektovano" : "Nema vozila";
  elements.vehicleSubtitle.textContent = hasVehicle ? "Auto je ispred rampe" : "Ceka se senzor udaljenosti";
  elements.carShape.classList.toggle("is-hidden", !hasVehicle);
  elements.distanceValue.textContent = distanceText;
  elements.distanceMeta.textContent = `Udaljenost: ${distanceText === "--" ? "--" : `${distanceText} cm`}`;
  elements.buzzerState.textContent = state.buzzerEnabled ? "Ukljucen" : "Iskljucen";
  elements.lastUpdate.textContent = formatClock(state.updatedAt);

  const lastCommand = state.lastProcessedCommand || {};
  elements.lastCommandValue.textContent = `${formatValue(lastCommand.name)} / ${formatValue(lastCommand.value)}`;
  renderEspConnection(state);
  renderCommandButtons();
  refreshIcons();
}

function renderConfig(config) {
  if (!config) {
    return;
  }

  if (config.detectionDistanceCm) {
    elements.detectionDistanceInput.value = clampNumber(config.detectionDistanceCm, 25, 5, 200);
  }

  if (config.gateOpenMs) {
    elements.gateOpenMsInput.value = clampNumber(config.gateOpenMs, 4000, 1000, 30000);
  }

  if (typeof config.buzzerEnabled === "boolean") {
    elements.buzzerEnabledInput.checked = config.buzzerEnabled;
  }
}

function renderActivityRows(commands) {
  if (!commands.length) {
    return `<div class="empty-state">Jos nema aktivnosti.</div>`;
  }

  return commands
    .map((command) => {
      const presentation = getCommandPresentation(command);
      return `
        <div class="activity-row">
          <span class="activity-time">${formatClock(command.timestamp)}</span>
          <span class="activity-icon ${presentation.tone}">
            <i data-lucide="${presentation.icon}" aria-hidden="true"></i>
          </span>
          <span class="activity-main">
            <strong>${presentation.title}</strong>
            <span>${presentation.subtitle}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderCommandLog() {
  elements.commandLog.innerHTML = renderActivityRows(recentCommands.slice(0, 7));
  elements.toggleActivitiesButton.disabled = false;
  elements.toggleActivitiesButton.textContent = "Pogledaj sve";
  renderAllCommandLog();

  refreshIcons();
}

function renderAllCommandLog() {
  elements.allCommandLog.innerHTML = renderActivityRows(recentCommands);
}

function openActivitiesModal() {
  renderAllCommandLog();
  elements.activitiesModal.hidden = false;
  document.body.classList.add("modal-open");
  refreshIcons();
}

function closeActivitiesModal() {
  elements.activitiesModal.hidden = true;
  document.body.classList.remove("modal-open");
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
    setConnectionStatus("Uredjaj je obavezan", "error");
    return;
  }

  activeDeviceId = nextDeviceId;
  detachListeners();
  latestState = null;
  currentGateOpen = false;
  currentHasVehicle = false;
  renderEspConnection(null);
  renderCommandButtons();

  const stateRef = ref(db, devicePath("state"));
  const configRef = ref(db, devicePath("config"));
  const commandsRef = query(ref(db, devicePath("commands")), orderByChild("timestamp"), limitToLast(50));
  const todayCommandsRef = query(ref(db, devicePath("commands")), orderByChild("timestamp"), startAt(getDayStartTimestamp()));

  listen(stateRef, (snapshot) => renderState(snapshot.val()));
  listen(configRef, (snapshot) => renderConfig(snapshot.val()));
  listen(commandsRef, (snapshot) => {
    const value = snapshot.val();
    recentCommands = value
      ? Object.entries(value)
        .map(([id, command]) => ({ id, ...command }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      : [];
    renderCommandLog();
  });
  listen(todayCommandsRef, (snapshot) => {
    const value = snapshot.val();
    const commands = value ? Object.values(value) : [];
    elements.todayCommandCount.textContent = String(commands.filter((command) => isToday(command.timestamp)).length);
  });
}

async function saveConfig(event) {
  event.preventDefault();

  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  try {
    await update(ref(db, devicePath("config")), {
      detectionDistanceCm: clampNumber(elements.detectionDistanceInput.value, 25, 5, 200),
      gateOpenMs: getGateOpenMs(),
      buzzerEnabled: elements.buzzerEnabledInput.checked,
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });

  } catch (error) {
    console.error(error);
    setConnectionStatus("Config nije sacuvan", "error");
  }
}

function init() {
  renderCommandButtons();
  renderCommandLog();
  elements.connectButton.addEventListener("click", connectToDevice);
  elements.configForm.addEventListener("submit", saveConfig);
  elements.toggleActivitiesButton.addEventListener("click", openActivitiesModal);
  elements.closeActivitiesModal.addEventListener("click", closeActivitiesModal);
  elements.activitiesModal.addEventListener("click", (event) => {
    if (event.target === elements.activitiesModal) {
      closeActivitiesModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.activitiesModal.hidden) {
      closeActivitiesModal();
    }
  });
  window.setInterval(() => renderEspConnection(latestState), 3000);

  if (!hasFirebaseConfig()) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    setConnectionStatus("Ceka ESP32", "warning");
    renderCommandButtons();
    connectToDevice();
  } catch (error) {
    console.error(error);
    setConnectionStatus("Firebase greska", "error");
  }
}

init();
