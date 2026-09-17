const byId = (id) => document.getElementById(id);
let credentialText = "";

const serviceFields = [
  ["RPC_URL", (data, rpcUrl) => rpcUrl],
  ["SETUP_CONTRACT_ADDRESS", (data) => data.setupContract],
  ["WALLET_ADDRESS", (data) => data.playerAddress],
];

function setStatus(mode, text) {
  byId("status-pill").className = `status ${mode}`.trim();
  byId("status-text").textContent = text;
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function bindCopyButton(button, value) {
  button.addEventListener("click", async () => {
    const original = button.textContent;
    try {
      await copyText(value);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Failed";
    }
    setTimeout(() => { button.textContent = original; }, 1200);
  });
}

function credentialRow(labelText, valueText) {
  const row = document.createElement("div");
  row.className = "field credential-row";

  const label = document.createElement("label");
  label.textContent = labelText;

  const valueRow = document.createElement("div");
  valueRow.className = "value-row";

  const value = document.createElement("code");
  value.textContent = valueText;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  bindCopyButton(copy, valueText);

  valueRow.append(value, copy);
  row.append(label, valueRow);
  return row;
}

function renderInfo(data) {
  const rpcUrl = new URL(data.rpcUrl || "/rpc", window.location.origin).href;
  if (!byId("faucet-address").value && data.playerAddress) {
    byId("faucet-address").value = data.playerAddress;
  }
  const values = serviceFields
    .map(([name, read]) => [name, read(data, rpcUrl)])
    .filter(([, value]) => value);

  credentialText = values.map(([name, value]) => `${name}=${value}`).join("\n");

  const credentials = byId("credentials");
  credentials.replaceChildren();
  values.forEach(([name, value]) => credentials.appendChild(credentialRow(name, value)));
}

function renderWallet(data) {
  const walletAddress = byId("wallet-address");
  if (walletAddress) walletAddress.textContent = data.address;
  const balances = byId("wallet-balances");
  balances.replaceChildren();

  Object.entries(data.balances).forEach(([symbol, amount]) => {
    const item = document.createElement("div");
    item.className = "balance-item";
    const label = document.createElement("span");
    label.textContent = symbol;
    const value = document.createElement("strong");
    value.textContent = amount.formatted;
    item.append(label, value);
    balances.appendChild(item);
  });

  const notice = byId("recovery-notice");
  notice.hidden = !data.depleted;
  if (data.depleted) {
    notice.textContent = "Funds are depleted. Save your patches, reset this instance through GZCTF, then reapply your upgrades.";
  } else {
    notice.textContent = "";
  }
}

async function loadWallet() {
  const button = byId("wallet-refresh");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/wallet", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderWallet(await response.json());
  } catch (error) {
    const walletAddress = byId("wallet-address");
    if (walletAddress) walletAddress.textContent = `Unable to load balances: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadInfo() {
  setStatus("", "Connecting");
  byId("refresh").disabled = true;
  try {
    const response = await fetch("/self-info", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderInfo(data);
    await loadWallet();
    setStatus("online", "Service Online");
  } catch (error) {
    setStatus("error", "Connection Failed");
    byId("credentials").textContent = `Unable to load instance: ${error.message}`;
  } finally {
    byId("refresh").disabled = false;
  }
}

async function requestFaucet(event) {
  event.preventDefault();
  const button = byId("faucet-button");
  const input = byId("faucet-address");
  const message = byId("faucet-message");
  button.disabled = true;
  message.className = "form-message";
  message.textContent = "Requesting funds...";
  try {
    const response = await fetch("/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: input.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    message.classList.add("success");
    message.textContent = data.funded
      ? `Funds sent to ${data.player}`
      : `${data.player} has already received its one-time grant.`;
  } catch (error) {
    message.classList.add("error");
    message.textContent = `Faucet failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

byId("refresh").addEventListener("click", loadInfo);
byId("wallet-refresh")?.addEventListener("click", loadWallet);
byId("copy-all").addEventListener("click", () => copyText(credentialText));
byId("faucet-form").addEventListener("submit", requestFaucet);
loadInfo();
setInterval(loadWallet, 5000);
