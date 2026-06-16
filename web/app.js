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

const entryCommands = [
  {
    id: "entryAllow",
    ramp: "entry",
    name: "gate.access",
    value: "allow",
    label: "Dozvoli pristup",
    icon: "arrow-up",
    tone: "success",
    requiresVehicle: true,
    manualOnly: true
  },
  {
    id: "entryDeny",
    ramp: "entry",
    name: "gate.access",
    value: "deny",
    label: "Zabrani pristup",
    icon: "hand",
    tone: "danger",
    requiresVehicle: true,
    manualOnly: true
  },
  {
    id: "entryGate",
    ramp: "entry",
    name: "gate.position",
    value: "toggle",
    label: "Otvori rampu",
    icon: "arrow-up",
    tone: "primary"
  },
  {
    id: "entryBuzzer",
    ramp: "entry",
    name: "buzzer.enabled",
    value: "toggle",
    label: "Buzzer ON",
    icon: "volume-2",
    tone: "warning"
  }
];

const exitCommands = [
  {
    id: "exitAllow",
    ramp: "exit",
    name: "gate2.access",
    value: "allow",
    label: "Dozvoli izlaz",
    icon: "arrow-up",
    tone: "success",
    requiresVehicle: true,
    manualOnly: true
  },
  {
    id: "exitDeny",
    ramp: "exit",
    name: "gate2.access",
    value: "deny",
    label: "Zabrani izlaz",
    icon: "hand",
    tone: "danger",
    requiresVehicle: true,
    manualOnly: true
  },
  {
    id: "exitGate",
    ramp: "exit",
    name: "gate2.position",
    value: "toggle",
    label: "Otvori rampu",
    icon: "arrow-up",
    tone: "primary"
  },
  {
    id: "exitBuzzer",
    ramp: "exit",
    name: "gate2.buzzer.enabled",
    value: "toggle",
    label: "Buzzer ON",
    icon: "volume-2",
    tone: "warning"
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
  exitCommandGrid: document.querySelector("#exitCommandGrid"),
  entryAutoToggle: document.querySelector("#entryAutoToggle"),
  exitAutoToggle: document.querySelector("#exitAutoToggle"),
  commandLog: document.querySelector("#commandLog"),
  allCommandLog: document.querySelector("#allCommandLog"),
  exportDailyReportButton: document.querySelector("#exportDailyReportButton"),
  toggleActivitiesButton: document.querySelector("#toggleActivitiesButton"),
  activitiesModal: document.querySelector("#activitiesModal"),
  closeActivitiesModal: document.querySelector("#closeActivitiesModal"),
  openSettingsModal: document.querySelector("#openSettingsModal"),
  settingsModal: document.querySelector("#settingsModal"),
  closeSettingsModal: document.querySelector("#closeSettingsModal"),
  openCameraModal: document.querySelector("#openCameraModal"),
  cameraModal: document.querySelector("#cameraModal"),
  closeCameraModal: document.querySelector("#closeCameraModal"),
  cameraForm: document.querySelector("#cameraForm"),
  cameraUrlInput: document.querySelector("#cameraUrlInput"),
  cameraStatus: document.querySelector("#cameraStatus"),
  clearCameraButton: document.querySelector("#clearCameraButton"),
  cameraLive: document.querySelector("#cameraLive"),
  cameraFrame: document.querySelector("#cameraFrame"),
  cameraButtonText: document.querySelector("#cameraButtonText"),
  entryPanel: document.querySelector("#entryPanel"),
  gateArm: document.querySelector("#gateArm"),
  carShape: document.querySelector("#carShape"),
  vehicleTitle: document.querySelector("#vehicleTitle"),
  vehicleSubtitle: document.querySelector("#vehicleSubtitle"),
  distanceValue: document.querySelector("#distanceValue"),
  distanceMeta: document.querySelector("#distanceMeta"),
  exitDistanceValue: document.querySelector("#exitDistanceValue"),
  exitDistanceMeta: document.querySelector("#exitDistanceMeta"),
  lastCommandValue: document.querySelector("#lastCommandValue"),
  todayCommandCount: document.querySelector("#todayCommandCount"),
  activityUpdatedAt: document.querySelector("#activityUpdatedAt"),
  configForm: document.querySelector("#configForm"),
  entryDetectionDistanceInput: document.querySelector("#entryDetectionDistanceInput"),
  entryOpenDistanceInput: document.querySelector("#entryOpenDistanceInput"),
  entryGateOpenMsInput: document.querySelector("#entryGateOpenMsInput"),
  exitDetectDistanceInput: document.querySelector("#exitDetectDistanceInput"),
  exitOpenDistanceInput: document.querySelector("#exitOpenDistanceInput"),
  exitGateOpenMsInput: document.querySelector("#exitGateOpenMsInput"),
  rgbIdleColorInput: document.querySelector("#rgbIdleColorInput"),
  rgbWaitingColorInput: document.querySelector("#rgbWaitingColorInput"),
  rgbOpenColorInput: document.querySelector("#rgbOpenColorInput"),
  rgbDeniedColorInput: document.querySelector("#rgbDeniedColorInput")
};

let app;
let db;
let activeDeviceId = elements.deviceIdInput.value.trim();
let activeUnsubscribers = [];
let recentCommands = [];
let todayCommands = [];
let latestState = null;
let currentEntryGateOpen = false;
let currentExitGateOpen = false;
let currentEntryHasVehicle = false;
let currentExitHasVehicle = false;
let currentEntryBuzzerEnabled = false;
let currentExitBuzzerEnabled = false;
let latestConfig = null;

const ESP_ONLINE_STALE_MS = 8000;
const RGB_COLOR_VALUES = ["blue", "green", "red", "yellow", "white", "off"];
const CAMERA_STORAGE_PREFIX = "parkingCameraUrl";

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

function devicePath(childPath = "") {
  const basePath = `devices/${activeDeviceId}`;
  return childPath ? `${basePath}/${childPath}` : basePath;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
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

function formatShortDate(timestamp) {
  if (typeof timestamp !== "number") {
    return "--";
  }

  return new Intl.DateTimeFormat("sr-RS", {
    day: "numeric",
    month: "short"
  }).format(new Date(timestamp)).replace(".", "");
}

function formatFileDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (typeof distanceCm !== "number" || distanceCm < 0 || !Number.isFinite(distanceCm)) {
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

function getEntryDetectionDistanceCm() {
  return clampNumber(
    firstDefined(elements.entryDetectionDistanceInput.value, latestConfig?.entryDetectionDistanceCm, latestConfig?.detectionDistanceCm),
    25,
    5,
    200
  );
}

function getEntryOpenDistanceCm() {
  return clampNumber(
    firstDefined(elements.entryOpenDistanceInput.value, latestConfig?.entryOpenDistanceCm),
    10,
    2,
    getEntryDetectionDistanceCm()
  );
}

function getExitDetectDistanceCm() {
  return clampNumber(
    firstDefined(elements.exitDetectDistanceInput.value, latestConfig?.exitDetectDistanceCm),
    30,
    5,
    150
  );
}

function getExitOpenDistanceCm() {
  return clampNumber(elements.exitOpenDistanceInput.value, 20, 5, 150);
}

function getGateOpenMs(ramp = "entry") {
  const input = ramp === "exit" ? elements.exitGateOpenMsInput : elements.entryGateOpenMsInput;
  return clampNumber(input.value, 4000, 1000, 30000);
}

function getRgbValue(input, fallback) {
  return input.value || fallback;
}

function getConfigColor(value, fallback) {
  return RGB_COLOR_VALUES.includes(value) ? value : fallback;
}

function updateColorField(input) {
  input.closest(".color-field")?.setAttribute("data-color", input.value);
}

function updateColorFields() {
  [
    elements.rgbIdleColorInput,
    elements.rgbWaitingColorInput,
    elements.rgbOpenColorInput,
    elements.rgbDeniedColorInput
  ].forEach(updateColorField);
}

function getCameraStorageKey() {
  return `${CAMERA_STORAGE_PREFIX}:${activeDeviceId}`;
}

function getLocalCameraUrl() {
  return localStorage.getItem(getCameraStorageKey()) || "";
}

function setLocalCameraUrl(url) {
  if (url) {
    localStorage.setItem(getCameraStorageKey(), url);
    return;
  }

  localStorage.removeItem(getCameraStorageKey());
}

function getYouTubeVideoId(url) {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

    if (hostname === "youtu.be") {
      return pathParts[0] || "";
    }

    if (!hostname.endsWith("youtube.com")) {
      return "";
    }

    if (parsedUrl.pathname === "/watch") {
      return parsedUrl.searchParams.get("v") || "";
    }

    if (pathParts[0] === "live" || pathParts[0] === "embed" || pathParts[0] === "shorts") {
      return pathParts[1] || "";
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeEmbedUrl(url) {
  const videoId = getYouTubeVideoId(url);

  if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
    return "";
  }

  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0`;
}

function setCameraStatus(message, state = "") {
  elements.cameraStatus.textContent = message;
  elements.cameraStatus.classList.remove("is-error", "is-success");

  if (state) {
    elements.cameraStatus.classList.add(`is-${state}`);
  }
}

function renderCamera(url) {
  const embedUrl = getYouTubeEmbedUrl(url || "");
  const hasCamera = Boolean(embedUrl);

  elements.entryPanel.classList.toggle("has-camera", hasCamera);
  elements.openCameraModal.classList.toggle("is-configured", hasCamera);
  elements.cameraButtonText.textContent = hasCamera ? "Izmeni kameru" : "Prostor za kameru";
  elements.cameraLive.hidden = !hasCamera;

  if (hasCamera) {
    elements.cameraFrame.src = embedUrl;
    elements.cameraUrlInput.value = url;
    return;
  }

  elements.cameraFrame.removeAttribute("src");
  elements.cameraUrlInput.value = "";
}

function isEspStateFresh(state) {
  return typeof state?.updatedAt === "number" && Date.now() - state.updatedAt <= ESP_ONLINE_STALE_MS;
}

function isEspOnline(state) {
  return Boolean(state?.online) && isEspStateFresh(state);
}

function setSceneConnection(element, online) {
  element.textContent = online ? "Online" : "Offline";
  element.classList.toggle("is-offline", !online);
}

function renderEspConnection(state) {
  const online = isEspOnline(state);
  const hasState = Boolean(state);

  setConnectionStatus(online ? "ESP32 online" : "ESP32 offline", online ? "online" : "warning");
  setSceneConnection(elements.sceneConnection, online);
  elements.connectionMetric.textContent = online ? "Online" : "Offline";
  elements.connectionDetail.textContent = online
    ? "ESP32 salje stanje"
    : hasState
      ? `Zadnje stanje: ${formatClock(state.updatedAt)}`
      : "Ceka se ESP32";
}

function isGateOpen(value) {
  return value === "open" || value === "opened" || value === true;
}

function inferVehicle(carPresent, distanceCm, detectionDistance) {
  if (typeof distanceCm === "number" && distanceCm > detectionDistance) {
    return false;
  }

  if (typeof carPresent === "boolean") {
    return carPresent;
  }

  return typeof distanceCm === "number" && distanceCm > 0 && distanceCm <= detectionDistance;
}

function extractEntryState(state) {
  const entry = firstDefined(state?.gates?.entry, state?.entry, state?.rampa1, state?.ramp1, {});
  const distanceCm = firstDefined(
    entry.distanceCm,
    entry.distance,
    state?.distanceCm,
    state?.ultrasonicDistanceCm,
    state?.entryDistanceCm,
    state?.distance1Cm
  );
  const carPresent = firstDefined(entry.carPresent, state?.carPresent, state?.entryCarPresent, state?.car1Present);

  return {
    gateOpen: isGateOpen(firstDefined(entry.gate, entry.gatePosition, entry.position, state?.gate, state?.gatePosition, state?.position, state?.gate1)),
    distanceCm,
    carPresent: inferVehicle(carPresent, distanceCm, getEntryDetectionDistanceCm()),
    buzzerEnabled: Boolean(firstDefined(entry.buzzerEnabled, state?.buzzerEnabled, state?.entryBuzzerEnabled))
  };
}

function extractExitState(state) {
  const exit = firstDefined(state?.gates?.exit, state?.exit, state?.rampa2, state?.ramp2, {});
  const distanceCm = firstDefined(
    exit.distanceCm,
    exit.distance,
    state?.exitDistanceCm,
    state?.sharpDistanceCm,
    state?.distance2Cm
  );
  const carPresent = firstDefined(exit.carPresent, state?.exitCarPresent, state?.car2Present);

  return {
    gateOpen: isGateOpen(firstDefined(exit.gate, exit.gatePosition, exit.position, state?.exitGate, state?.gate2)),
    distanceCm,
    carPresent: inferVehicle(carPresent, distanceCm, getExitDetectDistanceCm()),
    buzzerEnabled: Boolean(firstDefined(exit.buzzerEnabled, state?.exitBuzzerEnabled, state?.gate2BuzzerEnabled))
  };
}

function getCommandGateState(command) {
  return command.ramp === "exit" ? currentExitGateOpen : currentEntryGateOpen;
}

function getCommandVehicleState(command) {
  return command.ramp === "exit" ? currentExitHasVehicle : currentEntryHasVehicle;
}

function getCommandBuzzerState(command) {
  return command.ramp === "exit" ? currentExitBuzzerEnabled : currentEntryBuzzerEnabled;
}

function getCommandAutoState(command) {
  return command.ramp === "exit" ? elements.exitAutoToggle.checked : elements.entryAutoToggle.checked;
}

function getCommandDisabledReason(command) {
  if (!db) {
    return "Unesi Firebase config";
  }

  if (command.manualOnly && getCommandAutoState(command)) {
    return "Dostupno kada iskljucis Auto rezim";
  }

  if (command.requiresVehicle && !getCommandVehicleState(command)) {
    return "Dostupno kada senzor detektuje vozilo";
  }

  return "";
}

function resolveCommand(command) {
  if (command.name.endsWith(".position")) {
    const shouldClose = getCommandGateState(command);
    return {
      ...command,
      value: shouldClose ? "close" : "open",
      label: shouldClose ? "Zatvori rampu" : "Otvori rampu",
      icon: shouldClose ? "arrow-down" : "arrow-up"
    };
  }

  if (command.name.includes("buzzer.enabled")) {
    const shouldEnable = !getCommandBuzzerState(command);
    return {
      ...command,
      value: shouldEnable,
      label: shouldEnable ? "Buzzer ON" : "Buzzer OFF",
      icon: shouldEnable ? "volume-2" : "volume-x"
    };
  }

  return command;
}

function canUseCommand(command) {
  return !getCommandDisabledReason(command);
}

function renderCommandGroup(container, commands) {
  container.innerHTML = commands
    .map((baseCommand, index) => {
      const command = resolveCommand(baseCommand);
      const disabled = canUseCommand(baseCommand) ? "" : "disabled";
      const title = getCommandDisabledReason(baseCommand);

      return `
        <button class="action-button" data-command-index="${index}" data-tone="${command.tone}" type="button" title="${title}" ${disabled}>
          <span class="action-icon"><i data-lucide="${command.icon}" aria-hidden="true"></i></span>
          <strong>${command.label}</strong>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll("[data-command-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = resolveCommand(commands[Number(button.dataset.commandIndex)]);
      sendCommand(command);
    });
  });
}

function renderCommandButtons() {
  renderCommandGroup(elements.commandGrid, entryCommands);
  renderCommandGroup(elements.exitCommandGrid, exitCommands);
  refreshIcons();
}

async function syncCommandConfig(command) {
  if (command.name === "buzzer.enabled") {
    await update(ref(db, devicePath("config")), {
      buzzerEnabled: Boolean(command.value),
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
  }

  if (command.name === "gate2.buzzer.enabled") {
    await update(ref(db, devicePath("config")), {
      gate2BuzzerEnabled: Boolean(command.value),
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
  }
}

async function sendCommand(command) {
  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  if (!canUseCommand(command)) {
    return;
  }

  try {
    const commandRef = push(ref(db, devicePath("commands")));
    const payload = {
      name: command.name,
      value: command.value,
      ramp: command.ramp,
      timestamp: serverTimestamp(),
      source: "web",
      requestId: crypto.randomUUID ? crypto.randomUUID() : commandRef.key
    };

    if (command.name.endsWith(".position")) {
      payload.openMs = getGateOpenMs(command.ramp);
    }

    await set(commandRef, payload);
    await syncCommandConfig(command);
  } catch (error) {
    console.error(error);
    setConnectionStatus("Slanje nije uspelo", "error");
  }
}

function getCommandTarget(command) {
  if (command.ramp === "exit" || command.name.startsWith("gate2.")) {
    return "Izlaz 01";
  }

  return "Ulaz 01";
}

function getCommandPresentation(command) {
  const target = getCommandTarget(command);
  const name = command.name;
  const value = command.value;

  if (name.endsWith(".access") && value === "allow") {
    return { title: `Pristup dozvoljen - ${target}`, subtitle: "Operator", icon: "arrow-up", tone: "success" };
  }

  if (name.endsWith(".access") && value === "deny") {
    return { title: `Pristup zabranjen - ${target}`, subtitle: "Operator", icon: "hand", tone: "danger" };
  }

  if (name.endsWith(".position") && value === "open") {
    return { title: `${target} otvorena`, subtitle: "Operator", icon: "arrow-up", tone: "primary" };
  }

  if (name.endsWith(".position") && value === "close") {
    return { title: `${target} zatvorena`, subtitle: "Operator", icon: "arrow-down", tone: "primary" };
  }

  if (name.includes("buzzer.enabled")) {
    return value === true || value === "true"
      ? { title: `Buzzer ukljucen - ${target}`, subtitle: "Operator", icon: "volume-2", tone: "warning" }
      : { title: `Buzzer iskljucen - ${target}`, subtitle: "Operator", icon: "volume-x", tone: "warning" };
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

function escapeCsvValue(value) {
  const text = formatValue(value).replaceAll('"', '""');
  return `"${text}"`;
}

function toCsvRow(values) {
  return values.map(escapeCsvValue).join(",");
}

function exportDailyReport() {
  const now = new Date();
  const rows = [
    ["Dnevni izvestaj parking rampe"],
    ["Datum", new Intl.DateTimeFormat("sr-RS", { dateStyle: "medium" }).format(now)],
    ["ESP32 konekcija", latestState && isEspOnline(latestState) ? "Online" : "Offline"],
    ["Komandi danas", todayCommands.length],
    [],
    ["Datum", "Vreme", "Rampa", "Komanda", "Vrednost", "Izvor", "Request ID"]
  ];

  todayCommands.forEach((command) => {
    rows.push([
      formatShortDate(command.timestamp),
      formatClock(command.timestamp),
      getCommandTarget(command),
      command.name,
      command.value,
      command.source || "--",
      command.requestId || command.id || "--"
    ]);
  });

  const csv = `\uFEFFsep=,\r\n${rows.map(toCsvRow).join("\r\n")}\r\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `parking-izvestaj-${formatFileDate(now)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderDistance(valueElement, metaElement, distanceCm) {
  const text = getDistanceText(distanceCm);
  valueElement.textContent = text;
  metaElement.textContent = `Udaljenost: ${text === "--" ? "--" : `${text} cm`}`;
}

function renderState(state) {
  latestState = state;

  if (!state) {
    currentEntryGateOpen = false;
    currentExitGateOpen = false;
    currentEntryHasVehicle = false;
    currentExitHasVehicle = false;
    currentEntryBuzzerEnabled = false;
    currentExitBuzzerEnabled = false;
    elements.gateArm.classList.remove("is-open");
    elements.carShape.classList.add("is-hidden");
    elements.vehicleTitle.textContent = "Nema vozila";
    elements.vehicleSubtitle.textContent = "Ceka se senzor udaljenosti";
    renderDistance(elements.distanceValue, elements.distanceMeta, null);
    renderDistance(elements.exitDistanceValue, elements.exitDistanceMeta, null);
    elements.lastCommandValue.textContent = "--";
    renderEspConnection(null);
    renderCommandButtons();
    refreshIcons();
    return;
  }

  const entry = extractEntryState(state);
  const exit = extractExitState(state);

  currentEntryGateOpen = entry.gateOpen;
  currentExitGateOpen = exit.gateOpen;
  currentEntryHasVehicle = entry.carPresent;
  currentExitHasVehicle = exit.carPresent;
  currentEntryBuzzerEnabled = entry.buzzerEnabled;
  currentExitBuzzerEnabled = exit.buzzerEnabled;

  elements.gateArm.classList.toggle("is-open", entry.gateOpen);
  elements.carShape.classList.toggle("is-hidden", !entry.carPresent);
  elements.vehicleTitle.textContent = entry.carPresent ? "Vozilo detektovano" : "Nema vozila";
  elements.vehicleSubtitle.textContent = entry.carPresent ? "Auto je ispred ulazne rampe" : "Ceka se senzor udaljenosti";
  renderDistance(elements.distanceValue, elements.distanceMeta, entry.distanceCm);
  renderDistance(elements.exitDistanceValue, elements.exitDistanceMeta, exit.distanceCm);

  const lastCommand = state.lastProcessedCommand || {};
  elements.lastCommandValue.textContent = `${formatValue(lastCommand.name)} / ${formatValue(lastCommand.value)}`;
  renderEspConnection(state);
  renderCommandButtons();
  refreshIcons();
}

function renderConfig(config) {
  latestConfig = config;

  if (!config) {
    elements.entryAutoToggle.checked = false;
    elements.exitAutoToggle.checked = true;
    elements.entryDetectionDistanceInput.value = 25;
    elements.entryOpenDistanceInput.value = 10;
    elements.entryGateOpenMsInput.value = 4000;
    elements.exitDetectDistanceInput.value = 30;
    elements.exitOpenDistanceInput.value = 20;
    elements.exitGateOpenMsInput.value = 4000;
    elements.rgbIdleColorInput.value = "blue";
    elements.rgbWaitingColorInput.value = "yellow";
    elements.rgbOpenColorInput.value = "green";
    elements.rgbDeniedColorInput.value = "red";
    updateColorFields();
    renderCamera(getLocalCameraUrl());
    renderCommandButtons();
    return;
  }

  elements.entryDetectionDistanceInput.value = clampNumber(
    firstDefined(config.entryDetectionDistanceCm, config.detectionDistanceCm),
    25,
    5,
    200
  );
  elements.entryOpenDistanceInput.value = clampNumber(
    config.entryOpenDistanceCm,
    10,
    2,
    getEntryDetectionDistanceCm()
  );
  elements.entryGateOpenMsInput.value = clampNumber(
    firstDefined(config.entryGateOpenMs, config.gateOpenMs),
    4000,
    1000,
    30000
  );
  elements.exitDetectDistanceInput.value = clampNumber(config.exitDetectDistanceCm, 30, 5, 150);
  elements.exitOpenDistanceInput.value = clampNumber(
    config.exitOpenDistanceCm,
    20,
    5,
    150
  );
  elements.exitGateOpenMsInput.value = clampNumber(
    firstDefined(config.exitGateOpenMs, config.gateOpenMs),
    4000,
    1000,
    30000
  );
  elements.rgbIdleColorInput.value = getConfigColor(config.entryRgbIdleColor, "blue");
  elements.rgbWaitingColorInput.value = getConfigColor(config.entryRgbWaitingColor, "yellow");
  elements.rgbOpenColorInput.value = getConfigColor(config.entryRgbOpenColor, "green");
  elements.rgbDeniedColorInput.value = getConfigColor(config.entryRgbDeniedColor, "red");

  elements.entryAutoToggle.checked = Boolean(config.entryAutoEnabled);
  elements.exitAutoToggle.checked = config.exitAutoEnabled !== false;
  renderCamera(config.cameraYoutubeUrl || getLocalCameraUrl());
  updateColorFields();
  renderCommandButtons();
}

function renderActivityRows(commands, options = {}) {
  if (!commands.length) {
    return `<div class="empty-state">Jos nema aktivnosti.</div>`;
  }

  return commands
    .map((command) => {
      const presentation = getCommandPresentation(command);
      const timeContent = options.showDate
        ? `<span class="activity-date">${formatShortDate(command.timestamp)}</span><span>${formatClock(command.timestamp)}</span>`
        : formatClock(command.timestamp);

      return `
        <div class="activity-row">
          <span class="activity-time">${timeContent}</span>
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
  const visibleCommands = recentCommands.slice(0, 7);
  elements.commandLog.innerHTML = renderActivityRows(visibleCommands);
  elements.activityUpdatedAt.textContent = visibleCommands.length ? formatClock(visibleCommands[0].timestamp) : "--";
  renderAllCommandLog();
  refreshIcons();
}

function renderAllCommandLog() {
  elements.allCommandLog.innerHTML = renderActivityRows(recentCommands, { showDate: true });
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

function openSettingsModal() {
  elements.settingsModal.hidden = false;
  document.body.classList.add("modal-open");
  updateColorFields();
  refreshIcons();
}

function closeSettingsModal() {
  elements.settingsModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openCameraModal() {
  const currentUrl = latestConfig?.cameraYoutubeUrl || getLocalCameraUrl();
  elements.cameraUrlInput.value = currentUrl;
  setCameraStatus("Podrzani su YouTube watch, live, youtu.be i embed linkovi.");
  elements.cameraModal.hidden = false;
  document.body.classList.add("modal-open");
  refreshIcons();
}

function closeCameraModal() {
  elements.cameraModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function saveCameraLink(event) {
  event.preventDefault();

  const url = elements.cameraUrlInput.value.trim();
  const embedUrl = getYouTubeEmbedUrl(url);

  if (!embedUrl) {
    setCameraStatus("Unesi validan YouTube live link.", "error");
    return;
  }

  setLocalCameraUrl(url);
  renderCamera(url);

  if (!db) {
    setCameraStatus("Kamera je sacuvana lokalno.", "success");
    closeCameraModal();
    return;
  }

  try {
    await update(ref(db, devicePath("config")), {
      cameraYoutubeUrl: url,
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
    setCameraStatus("Kamera je sacuvana.", "success");
    closeCameraModal();
  } catch (error) {
    console.error(error);
    setCameraStatus("Kamera nije sacuvana u Firebase-u, ali je ostala lokalno.", "error");
  }
}

async function clearCameraLink() {
  setLocalCameraUrl("");
  renderCamera("");

  if (!db) {
    closeCameraModal();
    return;
  }

  try {
    await update(ref(db, devicePath("config")), {
      cameraYoutubeUrl: "",
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
    closeCameraModal();
  } catch (error) {
    console.error(error);
    setCameraStatus("Kamera je uklonjena lokalno, ali Firebase nije azuriran.", "error");
  }
}

function detachListeners() {
  activeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  activeUnsubscribers = [];
}

function listen(refObject, callback) {
  activeUnsubscribers.push(onValue(refObject, callback));
}

function resetDashboardState() {
  latestState = null;
  latestConfig = null;
  recentCommands = [];
  todayCommands = [];
  elements.todayCommandCount.textContent = "0";
  renderState(null);
  renderConfig(null);
  renderCommandLog();
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
  resetDashboardState();

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
    todayCommands = value
      ? Object.entries(value)
        .map(([id, command]) => ({ id, ...command }))
        .filter((command) => isToday(command.timestamp))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      : [];
    elements.todayCommandCount.textContent = String(todayCommands.length);
  });
}

async function saveConfig(event) {
  event.preventDefault();

  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    return;
  }

  try {
    const entryDetectionDistanceCm = getEntryDetectionDistanceCm();
    const entryOpenDistanceCm = getEntryOpenDistanceCm();
    const entryGateOpenMs = getGateOpenMs("entry");
    const exitDetectDistanceCm = getExitDetectDistanceCm();
    const exitOpenDistanceCm = getExitOpenDistanceCm();
    const exitGateOpenMs = getGateOpenMs("exit");

    await update(ref(db, devicePath("config")), {
      detectionDistanceCm: entryDetectionDistanceCm,
      entryDetectionDistanceCm,
      entryOpenDistanceCm,
      exitDetectDistanceCm,
      exitOpenDistanceCm,
      gateOpenMs: entryGateOpenMs,
      entryGateOpenMs,
      exitGateOpenMs,
      entryAutoEnabled: elements.entryAutoToggle.checked,
      exitAutoEnabled: elements.exitAutoToggle.checked,
      entryRgbIdleColor: getRgbValue(elements.rgbIdleColorInput, "blue"),
      entryRgbWaitingColor: getRgbValue(elements.rgbWaitingColorInput, "yellow"),
      entryRgbOpenColor: getRgbValue(elements.rgbOpenColorInput, "green"),
      entryRgbDeniedColor: getRgbValue(elements.rgbDeniedColorInput, "red"),
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
    closeSettingsModal();
  } catch (error) {
    console.error(error);
    setConnectionStatus("Config nije sacuvan", "error");
  }
}

async function saveAutoModeConfig() {
  renderCommandButtons();

  if (!db) {
    setConnectionStatus("Unesi Firebase config", "error");
    renderConfig(null);
    return;
  }

  try {
    await update(ref(db, devicePath("config")), {
      entryAutoEnabled: elements.entryAutoToggle.checked,
      exitAutoEnabled: elements.exitAutoToggle.checked,
      updatedAt: serverTimestamp(),
      updatedBy: "web"
    });
  } catch (error) {
    console.error(error);
    setConnectionStatus("Auto rezim nije sacuvan", "error");
  }
}

function init() {
  renderCommandButtons();
  renderCommandLog();
  renderState(null);
  renderConfig(null);

  elements.connectButton.addEventListener("click", connectToDevice);
  elements.configForm.addEventListener("submit", saveConfig);
  elements.entryAutoToggle.addEventListener("change", saveAutoModeConfig);
  elements.exitAutoToggle.addEventListener("change", saveAutoModeConfig);
  elements.openSettingsModal.addEventListener("click", openSettingsModal);
  elements.closeSettingsModal.addEventListener("click", closeSettingsModal);
  elements.openCameraModal.addEventListener("click", openCameraModal);
  elements.closeCameraModal.addEventListener("click", closeCameraModal);
  elements.cameraForm.addEventListener("submit", saveCameraLink);
  elements.clearCameraButton.addEventListener("click", clearCameraLink);
  elements.exportDailyReportButton.addEventListener("click", exportDailyReport);
  elements.toggleActivitiesButton.addEventListener("click", openActivitiesModal);
  elements.closeActivitiesModal.addEventListener("click", closeActivitiesModal);
  [
    elements.rgbIdleColorInput,
    elements.rgbWaitingColorInput,
    elements.rgbOpenColorInput,
    elements.rgbDeniedColorInput
  ].forEach((input) => input.addEventListener("change", () => updateColorField(input)));
  elements.activitiesModal.addEventListener("click", (event) => {
    if (event.target === elements.activitiesModal) {
      closeActivitiesModal();
    }
  });
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) {
      closeSettingsModal();
    }
  });
  elements.cameraModal.addEventListener("click", (event) => {
    if (event.target === elements.cameraModal) {
      closeCameraModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!elements.activitiesModal.hidden) {
      closeActivitiesModal();
    }

    if (!elements.settingsModal.hidden) {
      closeSettingsModal();
    }

    if (!elements.cameraModal.hidden) {
      closeCameraModal();
    }
  });
  window.setInterval(() => renderEspConnection(latestState), 3000);

  if (!hasFirebaseConfig()) {
    setConnectionStatus("Firebase nije podesen", "error");
    elements.connectionMetric.textContent = "Offline";
    elements.connectionDetail.textContent = "Firebase config nije podesen";
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
    elements.connectionMetric.textContent = "Offline";
    elements.connectionDetail.textContent = "Firebase greska";
  }
}

init();
