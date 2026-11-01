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
const demoButton = document.querySelector("#demo-button");
const walletButton = document.querySelector("#wallet-button");
const walletButtonLabel = document.querySelector("#wallet-button-label");
const walletStatus = document.querySelector("#wallet-status");
const walletDisconnectKey = "creatorscout-wallet-disconnected";
const celoChainHex = "0xa4ec";
let connectedWalletAddress = null;
let isSubmitting = false;

const selectedPlatform = () =>
  document.querySelector('input[name="platform"]:checked').value;

function updateSearchAvailability() {
  submitButton.disabled = isSubmitting || !connectedWalletAddress;
  submitLabel.textContent = isSubmitting
    ? "Processing payment…"
    : connectedWalletAddress
      ? "Pay & run live scout"
      : "Connect Celo wallet to pay";
}

function abbreviatedAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function setWalletUI(address) {
  connectedWalletAddress = address || null;
  walletButton.classList.toggle("connected", Boolean(connectedWalletAddress));
  walletButtonLabel.textContent = connectedWalletAddress
    ? abbreviatedAddress(connectedWalletAddress)
    : "Connect wallet";
  updateSearchAvailability();
}

async function disconnectWallet(rememberChoice = true) {
  if (window.ethereum && connectedWalletAddress) {
    try {
      await window.ethereum.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (error) {
      if (error?.code !== 4200) {
        console.warn("Wallet permission revocation was not completed.", error);
      }
    }
  }
  if (rememberChoice) localStorage.setItem(walletDisconnectKey, "true");
  setWalletUI(null);
  walletStatus.textContent = "Disconnected from CreatorScout.";
}

async function connectWallet() {
  if (!window.ethereum) {
    walletStatus.textContent = "Install a compatible browser wallet to connect.";
    return;
  }
  walletButton.disabled = true;
  walletStatus.textContent = "Confirm the connection in your wallet.";
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("No wallet account was returned.");
    localStorage.removeItem(walletDisconnectKey);
    setWalletUI(accounts[0]);
    walletStatus.textContent = "Connected. You will confirm one USDC payment for each live scout.";
  } catch (error) {
    walletStatus.textContent = error?.code === 4001
      ? "Wallet connection was cancelled."
      : error.message || "Wallet connection could not be completed.";
  } finally {
    walletButton.disabled = false;
  }
}

async function restoreWalletConnection() {
  if (!window.ethereum || localStorage.getItem(walletDisconnectKey) === "true") return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts?.[0]) setWalletUI(accounts[0]);
  } catch {
    // The app remains usable when a wallet extension is unavailable.
  }
}

async function fetchPaymentConfig() {
  const response = await fetch("/api/payment-config");
  const data = await response.json();
  if (!response.ok || !data.success || !data.payment) {
    throw new Error(data.message || data.error || "Live payments are unavailable right now.");
  }
  return data.payment;
}

async function ensureCeloNetwork() {
  const currentChain = await window.ethereum.request({ method: "eth_chainId" });
  if (currentChain?.toLowerCase() === celoChainHex) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: celoChainHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: celoChainHex,
        chainName: "Celo Mainnet",
        nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
        rpcUrls: ["https://forno.celo.org"],
        blockExplorerUrls: ["https://celoscan.io"],
      }],
    });
  }
}

function buildUsdcTransferData(recipientAddress, amountAtomic, attributionSuffix) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
    throw new Error("The project wallet address is invalid.");
  }
  if (!/^0x[0-9a-fA-F]*$/.test(attributionSuffix || "")) {
    throw new Error("The payment attribution data is invalid.");
  }
  const amount = BigInt(amountAtomic);
  if (amount <= 0n) throw new Error("The live scout payment amount is invalid.");

  const recipient = recipientAddress.slice(2).toLowerCase().padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${recipient}${amountWord}${attributionSuffix.slice(2)}`;
}

async function waitForPaymentReceipt(transactionHash) {
  const timeoutAt = Date.now() + 120000;
  while (Date.now() < timeoutAt) {
    const receipt = await window.ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    });
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The Celo USDC payment was rejected.");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("The payment is still confirming. Please wait, then try the same scout again.");
}

async function makeCustomerPayment(payment) {
  if (!window.ethereum || !connectedWalletAddress) {
    throw new Error("Connect your Celo wallet before running a live scout.");
  }
  await ensureCeloNetwork();
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts?.[0] || accounts[0].toLowerCase() !== connectedWalletAddress.toLowerCase()) {
    setWalletUI(null);
    throw new Error("Your wallet connection changed. Connect it again to continue.");
  }

  const transactionHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from: connectedWalletAddress,
      to: payment.tokenAddress,
      value: "0x0",
      data: buildUsdcTransferData(
        payment.recipientAddress,
        payment.amountAtomic,
        payment.attributionSuffix,
      ),
    }],
  });
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash || "")) {
    throw new Error("Your wallet did not return a Celo payment transaction hash.");
  }
  await waitForPaymentReceipt(transactionHash);
  return transactionHash;
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
  resultsTitle.textContent = data.demo
    ? "Demo creator shortlist"
    : creators.length
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

  if (data.demo) {
    proofCard.innerHTML = "<strong>DEMO MODE</strong><br>These are example public creator profiles. No Buy request or Celo payment was made.";
  } else {
    const customerPayment = data.proof?.customerPayment?.transactionHash;
    const transaction = data.proof?.celoTransactionHash || "No transaction identifier was returned.";
    const endpoint = data.proof?.useBuyEndpoint || "";
    const hasCustomerPaymentHash = /^0x[a-fA-F0-9]{64}$/.test(customerPayment || "");
    const hasTransactionHash = /^0x[a-fA-F0-9]{64}$/.test(transaction);
    const customerProof = hasCustomerPaymentHash
      ? `<a class="proof-link" href="https://celoscan.io/tx/${customerPayment}" target="_blank" rel="noreferrer">View your USDC payment on CeloScan <span aria-hidden="true">↗</span></a>`
      : "Customer payment receipt was not returned.";
    const transactionProof = hasTransactionHash
      ? `<a class="proof-link" href="https://celoscan.io/tx/${transaction}" target="_blank" rel="noreferrer">View settlement on CeloScan <span aria-hidden="true">↗</span></a>`
      : `Transaction: ${escapeHtml(transaction)}`;
    proofCard.innerHTML = `<strong>CELO PAYMENT PROOF</strong><br>${customerProof}<br>Buy endpoint: ${escapeHtml(endpoint)}<br>${transactionProof}`;
  }
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
    await connectWallet();
  }
});
if (window.ethereum) {
  window.ethereum.on("accountsChanged", (accounts) => {
    if (accounts?.[0]) {
      localStorage.removeItem(walletDisconnectKey);
      setWalletUI(accounts[0]);
      walletStatus.textContent = "Wallet account changed.";
    } else {
      disconnectWallet(false);
    }
  });
  window.ethereum.on("chainChanged", () => {
    walletStatus.textContent = "Wallet network changed. Live scouts use Celo Mainnet.";
  });
}
document.querySelector("#new-scout").addEventListener("click", () => {
  results.hidden = true;
  document.querySelector("#scout").scrollIntoView({ behavior: "smooth", block: "start" });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!connectedWalletAddress) {
    status.textContent = "Connect your Celo wallet before running a live scout.";
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
  status.textContent = "Preparing your Celo USDC payment.";

  try {
    const payment = await fetchPaymentConfig();
    const paymentAmount = Number(payment.amountUsd);
    if (!Number.isFinite(paymentAmount) || paymentAmount !== maxResearchSpend) {
      throw new Error("The displayed live scout price no longer matches the payment configuration. Refresh and try again.");
    }
    status.textContent = `Confirm the ${payment.amountUsd} USDC payment in your wallet.`;
    const paymentTransactionHash = await makeCustomerPayment(payment);
    status.textContent = "Payment confirmed. CreatorScout is verifying it and running Buy.";
    payload.payment_tx_hash = paymentTransactionHash;
    payload.payment_from = connectedWalletAddress;
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

const demoProfiles = {
  YouTube: [
    { name: "Doctorly", handle: "@Doctorly", platform: "YOUTUBE", profileUrl: "https://youtube.com/@Doctorly" },
    { name: "Beauty Within", handle: "@beautywithin", platform: "YOUTUBE", profileUrl: "https://youtube.com/@beautywithin" },
    { name: "Lab Muffin Beauty Science", handle: "@LabMuffinBeautyScience", platform: "YOUTUBE", profileUrl: "https://youtube.com/@LabMuffinBeautyScience" },
  ],
  Instagram: [
    { name: "Cristiano Ronaldo", handle: "@cristiano", platform: "INSTAGRAM", profileUrl: "https://instagram.com/cristiano", followers: 680083148 },
  ],
  TikTok: [
    { name: "Laryssa Fernandes", handle: "@lafernandesss", platform: "TIKTOK", profileUrl: "https://tiktok.com/@lafernandesss", followers: 763580 },
    { name: "Jasmin", handle: "@jasminnlily_", platform: "TIKTOK", profileUrl: "https://tiktok.com/@jasminnlily_", followers: 1178608 },
    { name: "Kiyoko Beauty", handle: "@kiyokobeauty", platform: "TIKTOK", profileUrl: "https://tiktok.com/@kiyokobeauty", followers: 214374 },
  ],
  X: [
    { name: "Life Pad", handle: "@XLifepad", platform: "X", profileUrl: "https://x.com/XLifepad", followers: 48926 },
    { name: "Fatahillah", handle: "@Fatahilah03", platform: "X", profileUrl: "https://x.com/Fatahilah03", followers: 109035 },
    { name: "Wellness wins", handle: "@Bro_Code_x", platform: "X", profileUrl: "https://x.com/Bro_Code_x", followers: 176934 },
  ],
};

demoButton.addEventListener("click", () => {
  const niche = document.querySelector("#niche").value.trim() || "your niche";
  const platform = selectedPlatform();
  const context = {
    niche,
    brandName: document.querySelector("#brand-name").value.trim(),
    offer: document.querySelector("#campaign-offer").value.trim(),
  };
  renderResults({ demo: true, shortlist: demoProfiles[platform] || [] }, context);
  status.className = "form-status";
  status.textContent = "Showing example profiles. No payment was made.";
});

updateInstagramField();
updateSearchAvailability();
restoreWalletConnection();
