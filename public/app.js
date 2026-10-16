const form = document.querySelector("#scout-form");
const platformInputs = document.querySelectorAll('input[name="platform"]');
const instagramField = document.querySelector("#instagram-field");
const instagramHandle = document.querySelector("#instagram-handle");
const status = document.querySelector("#form-status");
const submitButton = form.querySelector('button[type="submit"]');
const submitLabel = submitButton.querySelector(".submit-label");
const results = document.querySelector("#results");
const creatorGrid = document.querySelector("#creator-grid");
const proofCard = document.querySelector("#proof-card");
const resultsTitle = document.querySelector("#results-title");
const walletButton = document.querySelector("#wallet-button");
const walletButtonLabel = document.querySelector("#wallet-button-label");
const walletStatus = document.querySelector("#wallet-status");
const walletDisconnectKey = "creatorscout-wallet-disconnected";
let connectedWalletAddress = null;
let isSubmitting = false;
let observedWalletProvider = null;

const selectedPlatform = () =>
  document.querySelector('input[name="platform"]:checked').value;

function abbreviatedAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function updateSearchAvailability() {
  const connected = Boolean(connectedWalletAddress);
  submitButton.disabled = !connected || isSubmitting;
  submitLabel.textContent = isSubmitting
    ? "Searching public data…"
    : connected
      ? "Find creators"
      : "Connect wallet to search";
}

function getMetaMaskProvider() {
  const legacyProvider = window.ethereum;
  const providers = legacyProvider?.providers || (legacyProvider ? [legacyProvider] : []);
  return providers.find((provider) => provider.isMetaMask && !provider.isRabby) || null;
}

function observeWalletProvider(provider) {
  if (!provider?.on || provider === observedWalletProvider) return;
  observedWalletProvider = provider;
  provider.on("accountsChanged", (accounts) => {
    if (accounts?.[0]) {
      localStorage.removeItem(walletDisconnectKey);
      setWalletUI(accounts[0]);
      walletStatus.textContent = "Wallet account changed.";
    } else {
      disconnectWallet(false);
    }
  });
}

function setWalletUI(address) {
  connectedWalletAddress = address || null;
  walletButton.classList.toggle("connected", Boolean(connectedWalletAddress));
  walletButtonLabel.textContent = connectedWalletAddress
    ? abbreviatedAddress(connectedWalletAddress)
    : "Connect MetaMask";
  updateSearchAvailability();
}

async function disconnectWallet(rememberChoice = true) {
  const provider = getMetaMaskProvider();
  if (provider && connectedWalletAddress) {
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (error) {
      // Some wallets do not support permission revocation. The app session still ends below.
      if (error?.code !== 4200) {
        console.warn("Wallet permission revocation was not completed.", error);
      }
    }
  }
  if (rememberChoice) localStorage.setItem(walletDisconnectKey, "true");
  setWalletUI(null);
  walletStatus.textContent = "Disconnected. Connecting again will request wallet approval.";
}

async function connectWallet() {
  const provider = getMetaMaskProvider();
  if (!provider) {
    walletStatus.textContent = "Install or unlock MetaMask to connect.";
    return;
  }

  observeWalletProvider(provider);
  walletButton.disabled = true;
  walletStatus.textContent = "Confirm the connection in MetaMask.";
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("No wallet account was returned.");
    localStorage.removeItem(walletDisconnectKey);
    setWalletUI(accounts[0]);
    walletStatus.textContent = "MetaMask connected. Scout requests will not prompt this wallet for payment.";
  } catch (error) {
    walletStatus.textContent = error?.code === 4001
      ? "Wallet connection was cancelled."
      : error.message || "Wallet connection could not be completed.";
  } finally {
    walletButton.disabled = false;
  }
}

async function restoreWalletConnection() {
  if (localStorage.getItem(walletDisconnectKey) === "true") return;
  const provider = getMetaMaskProvider();
  if (!provider) return;
  try {
    observeWalletProvider(provider);
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts?.[0]) setWalletUI(accounts[0]);
  } catch {
    // The page remains usable if the wallet extension is unavailable.
  }
}

function updateInstagramField() {
  const needsHandle = selectedPlatform() === "Instagram";
  instagramField.hidden = !needsHandle;
  instagramHandle.required = needsHandle;
  if (!needsHandle) instagramHandle.value = "";
}

function formatFollowers(value) {
  if (typeof value !== "number") return null;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function buildTailoredMessage(creator, context) {
  const firstName = String(creator.name || creator.handle || "there").trim().split(/\s+/)[0];
  const brandIntro = context.brandName
    ? `I'm reaching out from ${context.brandName}.`
    : "I'm reaching out about a creator partnership opportunity.";
  const offer = context.offer
    ? `We're putting together ${context.offer}.`
    : `We're looking to collaborate with creators in ${context.niche}.`;

  return `Hi ${firstName},\n\n${brandIntro} I came across your ${creator.platform} profile while researching ${context.niche} creators, and your content stood out.\n\n${offer} I think there could be a great fit for your audience.\n\nWould you be open to a quick chat about a paid collaboration?\n\nBest,`;
}

async function copyMessage(button) {
  const message = button.closest(".message-section").querySelector("textarea").value;
  const feedback = button.parentElement.querySelector(".copy-feedback");
  try {
    await navigator.clipboard.writeText(message);
    feedback.textContent = "Copied to clipboard";
  } catch {
    const textarea = button.closest(".message-section").querySelector("textarea");
    textarea.select();
    document.execCommand("copy");
    feedback.textContent = "Copied to clipboard";
  }
  window.setTimeout(() => { feedback.textContent = ""; }, 2200);
}

function renderResults(data, context) {
  const creators = data.shortlist || [];
  resultsTitle.textContent = creators.length
    ? `${creators.length} creator${creators.length === 1 ? "" : "s"} found`
    : "No creator profiles found";

  creatorGrid.replaceChildren();
  if (!creators.length) {
    creatorGrid.innerHTML = '<p class="empty-results">Try a more specific niche or another platform.</p>';
  } else {
    creators.forEach((creator) => {
      const card = document.createElement("article");
      card.className = "creator-card";
      const followers = formatFollowers(creator.followers);
      const tailoredMessage = buildTailoredMessage(creator, context);
      card.innerHTML = `
        <div class="creator-top">
          <span class="creator-platform">${escapeHtml(creator.platform)}</span>
          ${followers ? `<span class="creator-followers">${followers} followers</span>` : ""}
        </div>
        <h3>${escapeHtml(creator.name)}</h3>
        <p class="creator-handle">${escapeHtml(creator.handle)}</p>
        <a class="profile-link" href="${escapeHtml(creator.profileUrl)}" target="_blank" rel="noreferrer">View profile <span aria-hidden="true">↗</span></a>
        <section class="message-section">
          <div class="message-label">Tailored DM <span>Editable</span></div>
          <textarea class="message-text" aria-label="Tailored message for ${escapeHtml(creator.name)}">${escapeHtml(tailoredMessage)}</textarea>
          <div class="copy-row"><button class="copy-message" type="button">Copy message</button><span class="copy-feedback"></span></div>
        </section>
      `;
      card.querySelector(".copy-message").addEventListener("click", (event) => copyMessage(event.currentTarget));
      creatorGrid.append(card);
    });
  }

  const transaction = data.proof?.celoTransactionHash || "No transaction identifier was returned.";
  const endpoint = data.proof?.useBuyEndpoint || "";
  proofCard.innerHTML = `<strong>BUY / CELO PROOF</strong><br>Endpoint: ${endpoint}<br>Transaction: ${transaction}`;
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

platformInputs.forEach((input) => input.addEventListener("change", updateInstagramField));
walletButton.addEventListener("click", async () => {
  if (connectedWalletAddress) {
    walletButton.disabled = true;
    walletStatus.textContent = "Disconnecting wallet…";
    await disconnectWallet();
    walletButton.disabled = false;
  } else {
    connectWallet();
  }
});
document.querySelector("#new-scout").addEventListener("click", () => {
  results.hidden = true;
  document.querySelector("#scout").scrollIntoView({ behavior: "smooth", block: "start" });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!connectedWalletAddress) {
    status.textContent = "Connect your wallet before starting a scout.";
    status.className = "form-status error";
    return;
  }
  const budget = Number(document.querySelector("#budget").value);
  const maxResearchSpend = Number(document.querySelector("#research-spend").value);

  if (maxResearchSpend > budget) {
    status.textContent = "Research spend cap cannot be higher than the campaign budget.";
    status.className = "form-status error";
    return;
  }

  const payload = {
    niche: document.querySelector("#niche").value.trim(),
    platform: selectedPlatform(),
    budget,
    max_research_spend: maxResearchSpend,
  };
  if (payload.platform === "Instagram") {
    payload.instagram_handle = instagramHandle.value.trim();
  }
  const campaignContext = {
    niche: payload.niche,
    brandName: document.querySelector("#brand-name").value.trim(),
    offer: document.querySelector("#campaign-offer").value.trim(),
  };

  isSubmitting = true;
  updateSearchAvailability();
  status.className = "form-status";
  status.textContent = "Buy is preparing your research request.";

  try {
    const response = await fetch("/api/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || data.error || "The scout request could not be completed.");
    status.textContent = "Shortlist ready.";
    renderResults(data, campaignContext);
  } catch (error) {
    status.textContent = error.message || "The scout request could not be completed.";
    status.className = "form-status error";
  } finally {
    isSubmitting = false;
    updateSearchAvailability();
  }
});

updateInstagramField();
updateSearchAvailability();
restoreWalletConnection();
