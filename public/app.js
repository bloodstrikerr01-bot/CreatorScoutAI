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
let isSubmitting = false;

const selectedPlatform = () =>
  document.querySelector('input[name="platform"]:checked').value;

function updateSearchAvailability() {
  submitButton.disabled = isSubmitting;
  submitLabel.textContent = isSubmitting
    ? "Searching public data…"
    : "Run live scout";
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
    const transaction = data.proof?.celoTransactionHash || "No transaction identifier was returned.";
    const endpoint = data.proof?.useBuyEndpoint || "";
    const hasTransactionHash = /^0x[a-fA-F0-9]{64}$/.test(transaction);
    const transactionProof = hasTransactionHash
      ? `<a class="proof-link" href="https://celoscan.io/tx/${transaction}" target="_blank" rel="noreferrer">View settlement on CeloScan <span aria-hidden="true">↗</span></a>`
      : `Transaction: ${escapeHtml(transaction)}`;
    proofCard.innerHTML = `<strong>BUY / CELO PROOF</strong><br>Endpoint: ${escapeHtml(endpoint)}<br>${transactionProof}`;
  }
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

platformInputs.forEach((input) => input.addEventListener("change", updateInstagramField));
document.querySelector("#new-scout").addEventListener("click", () => {
  results.hidden = true;
  document.querySelector("#scout").scrollIntoView({ behavior: "smooth", block: "start" });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
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
