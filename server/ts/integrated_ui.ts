/** Household and firmware views; all Bluetooth operations belong to the bridge. */
import { SCALE_MODELS, scaleModel } from "./models.ts";
import { currentLocale, t } from "./i18n/index.ts";
import { escapeHtml as e, hidden, timeLabel } from "./ui.ts";
import { WEB_APP_VERSION } from "./version.ts";
import { icon } from "./views/icons.ts";
import { buttonLink, kv, pageHeader, raw } from "./views/components.ts";
type Row = Record<string, any>;

export function timeZoneSelect(name: string, value = "", id = ""): string {
  return `<select name="${e(name)}"${id ? ` id="${e(id)}"` : ""} data-timezone-select data-selected-zone="${e(value)}" data-your-zone-label="${e(t("set.tzYours"))}"><option value="${e(value || "UTC")}">${e(value || "UTC")}</option></select>`;
}

/** The few dynamic labels firmware.js sets itself; it reads them from data-i18n (CSP: no inline scripts). */
function firmwareScriptStrings(): string {
  const keys = ["connected", "unrecognised", "idRequired", "bridgeOn", "unknown", "demo", "reconnecting", "useHost", "lanAddress", "connectButton", "flashUnknown", "flashPrompt", "enrollLocal", "hostLimits"] as const;
  const strings: Record<string, string> = {
    disconnected: t("fw.disconnected"), bridgeOff: t("fw.bridgeOffline"), generate: t("fw.generate", { model: "{model}" }),
    flashTitle: t("fw.flashTitle"), enrollText: t("fw.enrollText"),
  };
  for (const key of keys) strings[key] = t(`fwjs.${key}`);
  return JSON.stringify(strings);
}
export function firmwareWorkspace(csrf: string): string {
  return `<div id="firmware-workspace" data-csrf="${e(csrf)}" data-i18n="${e(firmwareScriptStrings())}" data-local-roster-models="${Object.keys(SCALE_MODELS).filter((model) => SCALE_MODELS[model].localRoster).join(",")}">${pageHeader({ title: t("fw.title"), subtitle: t("fw.subtitle"), actionsHtml: `<div id="bridge-connection" class="bridge-status is-offline"><span class="status-dot" aria-hidden="true"></span><span id="bridge-status-text" role="status">${e(t("fw.bridgeOffline"))}</span><button type="button" id="revoke-bridge" class="text-button" title="${e(t("fw.disconnectTitle"))}" hidden>${e(t("fw.disconnectBridge"))}</button></div>` })}
    <section id="bridge-offline"><h2>${e(t("fw.connectBridge"))}</h2>
      <p>${e(t("fw.connectBridgeLead"))}</p>
      <ol><li>${e(t("fw.stepInstall"))} <code>python3.11 -m venv .venv &amp;&amp; .venv/bin/pip install ./bridge</code></li>
      <li>${e(t("fw.stepRun", { cmd: "\u0000" })).replace("\u0000", "<code>.venv/bin/yow-bridge</code>")}</li><li>${e(t("fw.stepInvite"))}</li></ol>
      <div class="action-row"><button id="new-invitation" type="button">${e(t("fw.newInvitation"))}</button><button id="copy-invitation" class="secondary" type="button" hidden>${e(t("fw.copyInvitation"))}</button></div>
      <label id="invitation-label" hidden>${e(t("fw.invitationLabel"))}<textarea id="bridge-invitation" readonly rows="3" spellcheck="false"></textarea></label>
      <p class="hint">${e(t("fw.invitationHint"))}</p></section>
    <div id="bridge-online" hidden>
      <section id="connect-panel"><div class="section-heading"><h2>${e(t("fw.connect"))}</h2><span class="badge" id="connection-state">${e(t("fw.disconnected"))}</span></div>
        <p class="hint">${e(t("fw.putSetupMode"))}</p>
        <div class="action-row"><button id="scan-ble" type="button" title="${e(t("fw.scanBleTitle"))}">${e(t("fw.scanBle"))}</button><button id="scan-classic" type="button" title="${e(t("fw.scanClassicTitle"))}">${e(t("fw.scanClassic"))}</button><span id="scan-status" role="status" aria-live="polite"></span></div>
        <div id="candidates" class="wide"></div>
        <dl id="device-identity" class="identity-grid"></dl>
        <p id="connection-warning" class="notice" role="alert" hidden></p>
        <div id="unsupported-firmware" class="unsupported-firmware form-block" hidden>
          <h3>${e(t("fw.helpIdentify"))}</h3><p class="hint">${e(t("fw.helpIdentifyText"))}</p>
          <div class="field-list"><label>${e(t("fw.modelCode"))}<input id="offer-model-code" placeholder="WBS08" maxlength="6" autocapitalize="characters" spellcheck="false" required></label><label>${e(t("fw.versionToReport"))}<input id="offer-reported-version" type="number" min="0" max="65535" required></label><label>${e(t("fw.manufacturerId"))}<input id="offer-manufacturer-id" type="number" min="0" max="2147483647" value="0"></label></div>
          <p class="hint">${e(t("fw.offerHint"))}</p>
          <button id="check-firmware-offer" type="button">${e(t("fw.checkOffer"))}</button>
          <div id="firmware-offer-result" class="firmware-offer-result" hidden><dl class="identity-grid"><dt>${e(t("fw.firmwareUrl"))}</dt><dd id="offer-url"></dd><dt>SHA-1</dt><dd><code id="offer-hash"></code></dd></dl><p class="hint">${e(t("fw.offerMetadata"))}</p><button id="copy-firmware-offer" type="button" class="secondary">${e(t("fw.copyIssue"))}</button></div>
        </div>
        <div class="action-row connection-actions"><button id="complete-setup" type="button" disabled title="${e(t("fw.completeSetupTitle"))}">${e(t("fw.completeSetup"))}</button><button id="disconnect" type="button" class="text-button" disabled>${e(t("fw.disconnectScale"))}</button><button id="probe" type="button" class="text-button" hidden>${e(t("fw.retryProbe"))}</button><button id="reveal-secret" type="button" class="text-button" hidden>${e(t("fw.revealSecret"))}</button><button id="import-device" type="button" class="text-button" hidden>${e(t("fw.importDevice"))}</button><button id="export-device" type="button" class="text-button" hidden>${e(t("fw.exportDevice"))}</button></div>
        <code id="device-secret" hidden></code>
      </section>
      <div class="firmware-grid">
        <section id="firmware-panel"><h2>${e(t("fw.firmware"))}</h2>
          <div class="form-block"><label>${e(t("fw.targetModel"))}<select id="scale-model">${Object.entries(SCALE_MODELS).map(([v, m]) => `<option value="${v}">${m.label}</option>`).join("")}</select></label>
          <p class="hint">${e(t("fw.generateText"))}</p>
          <div class="action-row"><button id="generate-firmware" type="button">${e(t("fw.generate", { model: "WBS06" }))}</button><label class="text-button file-link">${e(t("fw.selectManually"))}<input id="manual-firmware" type="file" accept=".bin" hidden></label></div></div>
          <div id="firmware-info" class="firmware-artifact" hidden></div>
          <p id="firmware-warning" class="notice" hidden></p>
          <div class="action-row"><button id="install-firmware" type="button" disabled>${e(t("fw.installUpdate"))}</button><button id="download-firmware" type="button" class="text-button" hidden>${e(t("fw.downloadFirmware"))}</button></div>
          <div id="operation-status" class="inline-status" hidden aria-live="polite"><p id="operation-message"></p><progress id="operation-progress" hidden max="1" value="0" aria-label="${e(t("fw.progress"))}"></progress></div>
        </section>
        <section id="configure-panel"><div class="section-heading"><h2>${e(t("fw.configure"))}</h2><button id="read-configuration" type="button" class="text-button" disabled>${e(t("fw.readFromScale"))}</button></div>
          <form id="server-form" class="form-block"><h3>${e(t("fw.server"))}</h3><label>${e(t("fw.serverHostname"))}<input id="server-host" autocomplete="off" placeholder="scales.example.com" required></label><button id="use-this-host" type="button" class="text-button">${e(t("fw.useThisHost"))}</button>
          <label>${e(t("fw.transport"))}<select id="server-transport"><option value="https">HTTPS</option><option value="http">HTTP</option></select></label><p id="host-limits" class="hint"></p><button id="set-server" disabled>${e(t("fw.saveServer"))}</button></form>
          <form id="wifi-form" class="form-block"><h3>${e(t("fw.wifi"))}</h3><label>${e(t("fw.ssid"))}<input id="wifi-ssid" maxlength="32" autocomplete="off" required></label><label>${e(t("fw.wifiPassword"))}<input id="wifi-password" type="password" autocomplete="new-password" minlength="8" required></label><p id="wifi-password-hint" class="hint">${e(t("fw.wifiPasswordHint"))}</p><button id="connect-wifi" disabled>${e(t("fw.saveWifi"))}</button><p id="wifi-status" class="hint" role="status"></p></form>
          <div class="form-block"><h3>${e(t("fw.timeZone"))}</h3><label>${e(t("fw.scaleTimeZone"))}${timeZoneSelect("time_zone", "", "scale-timezone")}</label><button id="set-time" class="secondary" type="button" disabled>${e(t("fw.saveTimeZone"))}</button><p class="hint">${e(t("fw.timeZoneHint"))}</p></div>
        </section>
      </div>
    </div>
    <div id="toast-region" class="toast-region" role="status" aria-live="polite" aria-relevant="additions" aria-label="${e(t("fw.notifications"))}"></div>
    <dialog id="flash-dialog"><button class="dialog-close" data-close-dialog type="button" aria-label="${e(t("common.close"))}">×</button><h2 id="flash-title">${e(t("fw.flashTitle"))}</h2><p id="flash-warning" class="notice" hidden></p><p>${e(t("fw.flashText"))}</p><p id="flash-summary" class="firmware-artifact"></p><label><span id="flash-prompt">${e(t("fw.flashPrompt"))}</span><input id="flash-confirmation" autocomplete="off" spellcheck="false" aria-describedby="flash-warning flash-summary"></label><div class="dialog-actions"><button id="confirm-flash" type="button" disabled>${e(t("fw.confirmUpdate"))}</button><button type="button" data-close-dialog class="secondary">${e(t("common.cancel"))}</button></div></dialog>
    <dialog id="enroll-dialog"><button class="dialog-close" type="button" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("fw.enrollTitle"))}</h2><p id="enroll-description">${e(t("fw.enrollText"))}</p><label>${e(t("fw.scaleName"))}<input id="device-label" maxlength="80"></label><div class="dialog-actions"><button id="confirm-enroll" type="button">${e(t("fw.importDevice"))}</button><button type="button" data-close-dialog class="secondary">${e(t("common.later"))}</button></div></dialog>
    <dialog id="roster-dialog"><button class="dialog-close" type="button" data-close-dialog aria-label="${e(t("common.close"))}">×</button><h2>${e(t("fw.rosterTitle"))}</h2><p id="roster-message"></p><div id="roster-users"></div><div class="dialog-actions"><button id="confirm-roster" type="button">${e(t("fw.importSelectedUsers"))}</button><button type="button" data-close-dialog class="secondary">${e(t("common.later"))}</button></div></dialog>
  </div><script src="/firmware.js?v=${WEB_APP_VERSION}" defer></script>`;
}

function editDevice(s: Row, csrf: string, users: Row[]): string {
  const advanced = [
    ["goff", t("sc.advancedUtc")],
    ["dst", t("sc.advancedDst")],
    ["ngoff", t("sc.advancedNgoff")],
    ["feature_mask", t("sc.advancedMask")],
    ["beta_ws", t("sc.advancedBeta")],
    ["temp_code", t("sc.advancedTemp")],
    ["weight_code", t("sc.advancedWeight")],
  ];
  return `<dialog id="edit-device-${e(s.id)}"><button class="dialog-close" data-close-dialog type="button" aria-label="${e(t("common.close"))}">×</button><h2>${e(t("sc.editSettings"))}</h2>
    <form action="/scales/${e(s.id)}" method="post">${hidden(csrf)}<input type="hidden" name="purpose" value="device_config">
    <label>${e(t("sc.name"))}<input name="label" value="${e(s.label)}" maxlength="80" required></label><label>${e(t("sc.timeZone"))}${timeZoneSelect("time_zone", s.time_zone || "")}</label>
    ${scaleModel(s.model)?.localRoster ? `<fieldset><legend>${e(t("sc.usersOnScale"))}</legend><p>${e(t("sc.usersOnScaleText"))}</p>${users.map((u) => `<label><input type="checkbox" name="user_ids" value="${e(u.id)}"${s.userIds?.includes(u.id) ? " checked" : ""}> ${e(u.name)}</label>`).join("") || `<p><a href="/users">${e(t("sc.addUserFirst"))}</a>${e(t("sc.addUserFirstSuffix"))}</p>`}</fieldset>` : ""}
    <details class="advanced-settings"><summary>${e(t("sc.advanced"))}</summary><dl class="identity-grid"><dt>${e(t("sc.lastSync"))}</dt><dd>${s.last_session_at ? timeLabel(s.last_session_at) : e(t("sc.notYetSeen"))}</dd></dl><p class="hint">${e(t("sc.internalHint"))}</p><div class="field-list">${scaleModel(s.model)?.transport === "classic" || scaleModel(s.model)?.localRoster ? "" : advanced.map(([key, label]) => `<label>${label}<input type="number" name="${key}" value="${e(s[key] ?? 0)}"></label>`).join("")}</div>${scaleModel(s.model)?.classicGates ? `<p class="hint">${e(t("sc.retainsInternal"))}</p>` : ""}</details>
    <div class="dialog-actions"><button>${e(t("sc.saveSettings"))}</button><button class="secondary" type="button" data-close-dialog>${e(t("common.cancel"))}</button></div></form>${scaleModel(s.model)?.localRoster ? "" : `<form action="/users/fetch-withings" method="post" class="modal-secondary-action">${hidden(csrf)}<input type="hidden" name="scale_id" value="${e(s.id)}"><button class="text-button">${e(!scaleModel(s.model)?.classicGates && !s.settings_ready ? t("sc.finishImport") : t("sc.importUsersWithings"))}</button></form>`}</dialog>`;
}
function firmwareRow(s: Row): string {
  const known = s.firmware_version != null && s.firmware_confirmed_at != null;
  const hint = known
    ? t("sc.confirmedVia", { when: new Date(s.firmware_confirmed_at * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC"), via: s.firmware_source === "wifi" ? t("sc.viaWifi") : t("sc.viaBluetooth") })
    : t("sc.noFirmwareSeen");
  return `<tr><th>${e(t("fw.firmware"))} <span class="info-tip" tabindex="0" role="note" aria-label="${e(t("sc.firmwareConfirmation"))}" aria-describedby="firmware-time-${e(s.id)}"><span aria-hidden="true">ⓘ</span><span role="tooltip" id="firmware-time-${e(s.id)}">${e(hint)}</span></span></th><td>${known ? `v${e(s.firmware_version)}` : e(t("sc.notYetConfirmed"))}</td></tr>`;
}
export function scalesWorkspace(
  scales: Row[],
  csrf: string,
  users: Row[] = [],
): string {
  return `${pageHeader({ title: t("sc.title"), subtitle: t("sc.subtitle") })}
    <div class="scale-cards">${
      scales.length
        ? scales
            .map(
              (
                s,
              ) => `<section class="card scale-card" id="scale-${e(s.id)}"><div class="card-header"><h2 class="card-title">${e(s.label)}</h2><span class="scale-status ${!scaleModel(s.model)?.classicGates && !s.settings_ready ? "is-warn" : "is-ready"} card-actions">${icon(!scaleModel(s.model)?.classicGates && !s.settings_ready ? "alert-triangle" : "check", { size: 14 })}<span class="badge">${e(scaleModel(s.model)?.classicGates || s.settings_ready ? t("sc.ready") : scaleModel(s.model)?.localRoster ? t("sc.chooseUsers") : t("sc.importIncomplete"))}</span></span></div>
      <table class="scale-details"><tbody><tr><th>${e(t("sc.model"))}</th><td>${scaleModel(s.model)?.fullLabel ?? s.model}</td></tr><tr><th>${e(t("sc.mac"))}</th><td><code>${e(
        String(s.mac)
          .replace(/(..)(?=.)/g, "$1:")
          .toUpperCase(),
      )}</code></td></tr>${firmwareRow(s)}<tr><th>${e(t("sc.secret"))}</th><td><button class="secret-reveal btn btn-ghost btn-sm" type="button" data-reveal-secret="scale-secret-${e(s.id)}" aria-expanded="false">${e(t("sc.reveal"))}</button><code id="scale-secret-${e(s.id)}" hidden>${e(s.secret)}</code></td></tr></tbody></table>
      <div class="card-footer"><button type="button" class="btn btn-secondary btn-sm" data-open-dialog="edit-device-${e(s.id)}">${e(t("sc.editSettings"))}</button></div></section>`,
            )
            .join("")
        : `<section class="card empty-state"><p class="empty-title">${e(t("sc.none"))}</p>${buttonLink("/firmware", t("dash.connectScale"))}</section>`
    }</div>
    ${scales.map((s) => editDevice(s, csrf, users)).join("")}
    <div class="page-footer"><button class="btn btn-ghost" type="button" data-open-dialog="device-file-dialog">${e(t("sc.importDeviceFile"))}</button></div>
    <dialog id="device-file-dialog"><button class="dialog-close" data-close-dialog type="button" aria-label="${e(t("common.close"))}">×</button><h2>${e(t("sc.importDeviceFile"))}</h2><form action="/scales/import-ble" method="post" enctype="multipart/form-data">${hidden(csrf)}<label>${e(t("sc.nameOptional"))}<input name="label" maxlength="80"></label><label>${e(t("sc.deviceExport"))}<input type="file" name="record" accept=".json" required></label><label>${e(t("sc.timeZone"))}${timeZoneSelect("time_zone")}</label><button>${e(t("sc.importDevice"))}</button></form></dialog>`;
}
const copyButton = (value: string, label: string, target = ""): string =>
  `<button type="button" class="btn btn-ghost btn-icon btn-sm" ${target ? `data-copy-target="${e(target)}"` : `data-copy="${e(value)}"`} aria-label="${e(label)}">${icon("copy", { size: 16 })}</button>`;
const copyValue = (text: string, label: string): string =>
  `<span class="copy-value"><code>${e(text)}</code>${copyButton(text, label)}</span>`;
/** Escapes `text` and swaps the \u0001, \u0002… placeholders for <code> spans, so translations can reorder them. */
function codeText(text: string, codes: string[]): string {
  return e(text).replace(/[\u0001-\u0004]/g, (ch) => `<code>${e(codes[ch.charCodeAt(0) - 1])}</code>`);
}
export function syncPage(origin: string, users: Row[]): string {
  const curl = `curl --user reader \\\n  '${origin}/api/users/USER/readings?since=2026-01-01'`;
  const ids = users.length
    ? raw(users.map((u) => `<span class="copy-row"><span>${e(u.name)}</span>${copyValue(String(u.id), t("sync.copyIdOf", { name: String(u.name) }))}<span class="muted">${e(t("sync.or"))}</span>${copyValue(String(u.short_name), t("sync.copyShortOf", { name: String(u.name) }))}</span>`).join(""))
    : t("sync.addUserFirst");
  return `${pageHeader({ title: t("sync.title"), subtitle: t("sync.subtitle") })}
    <div class="card-grid"><section class="card"><div class="card-header"><h2 class="card-title">${e(t("sync.appleHealth"))}</h2></div><p>${e(t("sync.appleText"))}</p>
    <p>${buttonLink("/YourOwnWeigh-Sync.shortcut", t("sync.download"), { attrs: { download: "YourOwnWeigh Sync.shortcut" } })}</p>${kv([[t("sync.serverUrl"), raw(copyValue(origin, t("sync.copyServerUrl")))], [t("sync.userIdOrName"), ids], [t("sync.password"), t("sync.passwordText")]])}
    <p class="hint">${e(t("sync.dailyHint"))}</p></section>
    <section class="card"><div class="card-header"><h2 class="card-title">${e(t("sync.readHttp"))}</h2></div><p>${e(t("sync.httpText"))}</p><div class="code-box"><pre class="code" id="curl-example" tabindex="0">${e(curl)}</pre>${copyButton("", t("sync.copyCurl"), "#curl-example")}</div><p class="hint">${e(t("sync.curlHint"))}</p><p>${codeText(t("sync.pathsText", { readings: "\u0001", cursor: "\u0002", param: "\u0003", weights: "\u0004" }), ["/readings", "next_cursor", "cursor", "/weights"])}</p><p>${codeText(t("sync.endpointsText", { next: "\u0001", ack: "\u0002" }), ["health-sync/next", "health-sync/ack"])}</p></section></div>`;
}
export function settingsWorkspace(
  csrf: string,
  unit: string,
  separate: boolean,
  theme: "light" | "dark" | null = null,
): string {
  const units = [["kg", t("set.kg")], ["lb", t("set.lb")], ["st", t("set.st")]]
    .map(([v, l]) => `<option value="${v}"${v === unit ? " selected" : ""}>${e(l)}</option>`)
    .join("");
  const themes = [["system", t("theme.system")], ["light", t("theme.light")], ["dark", t("theme.dark")]]
    .map(([v, l]) => `<option value="${v}"${v === (theme ?? "system") ? " selected" : ""}>${e(l)}</option>`)
    .join("");
  const langs = (["en", "de"] as const)
    .map((v) => `<option value="${v}"${v === currentLocale() ? " selected" : ""}>${e(t(`lang.${v}`))}</option>`)
    .join("");
  return `${pageHeader({ title: t("set.title"), subtitle: t("set.subtitle") })}<div class="card-grid">
    <section class="card"><div class="card-header"><h2 class="card-title">${e(t("set.display"))}</h2></div><form action="/preferences" method="post" class="form-stack">${hidden(csrf)}<label>${e(t("set.weightUnit"))}<select name="weight_unit">${units}</select></label><div class="form-actions"><button>${e(t("set.saveDisplay"))}</button></div></form>
      <form action="/theme" method="get" class="form-stack theme-form"><input type="hidden" name="back" value="/settings"><label>${e(t("set.theme"))}<select name="set" data-submit-on-change>${themes}</select></label><div class="form-actions no-js-only"><button class="secondary">${e(t("set.applyTheme"))}</button></div></form>
      <form action="/lang" method="get" class="form-stack lang-form"><input type="hidden" name="back" value="/settings"><label>${e(t("set.language"))}<select name="set" data-submit-on-change>${langs}</select></label><div class="form-actions no-js-only"><button class="secondary">${e(t("set.applyLanguage"))}</button></div></form></section>
    <section class="card backup-panel"><div class="card-header"><h2 class="card-title">${e(t("set.backup"))}</h2></div><p>${e(t("set.backupText"))}</p><div class="action-row"><a class="btn btn-secondary" href="/api/backup/export">${e(t("set.exportDb"))}</a><button type="button" class="secondary" data-open-dialog="backup-import-dialog">${e(t("set.importDb"))}</button></div><p class="hint">${e(t("set.exportHint"))}</p></section>
    <section class="card"><div class="card-header"><h2 class="card-title">${e(t("set.adminPassword"))}</h2></div><p>${e(separate ? t("set.separateText") : t("set.sharedText"))}</p><form action="/settings" method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="purpose" value="admin_password"><label>${e(t("set.currentAdmin"))}<input name="current" type="password" required autocomplete="current-password"></label><label>${e(t("set.newPassword"))}<input name="new" type="password" minlength="8" required autocomplete="new-password"></label><label>${e(t("set.confirmPassword"))}<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label><div class="form-actions"><button>${e(t("set.changeAdmin"))}</button></div></form></section>
    <section class="card"><div class="card-header"><h2 class="card-title">${e(t("set.syncPassword"))}</h2></div><form action="/settings" method="post" class="form-stack">${hidden(csrf)}<input type="hidden" name="purpose" value="sync_password"><label>${e(t("set.currentAdmin"))}<input name="current_admin" type="password" required autocomplete="current-password"></label><label><input type="checkbox" name="separate" value="1" data-toggle="sync-password-fields"${separate ? " checked" : ""}> ${e(t("set.separateSync"))}</label><div id="sync-password-fields" class="form-stack"${separate ? "" : " hidden"}><label>${e(t("set.newSync"))}<input name="new" type="password" minlength="8" autocomplete="new-password"></label><label>${e(t("set.confirmSync"))}<input name="confirm" type="password" minlength="8" autocomplete="new-password"></label></div><div class="form-actions"><button>${e(t("set.saveSync"))}</button></div></form></section></div>
    <dialog id="backup-import-dialog"><button class="dialog-close" data-close-dialog type="button" aria-label="${e(t("common.close"))}">×</button><h2>${e(t("set.importDb"))}</h2><p>${e(t("set.importDialogText"))}</p><form id="backup-import" action="/api/backup/import" method="post" enctype="multipart/form-data" class="form-stack">${hidden(csrf)}<label>${e(t("set.backupFile"))}<input type="file" name="backup" accept=".json" required></label><p class="hint">${e(t("set.importPasswordsHint"))}</p><div class="dialog-actions"><button>${e(t("set.review"))}</button><button type="button" class="secondary" data-close-dialog>${e(t("common.cancel"))}</button></div></form></dialog>`;
}
