import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { executeBuyScoutJob } from "./buy.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SUPPORTED_PLATFORMS = new Set(["youtube", "instagram", "tiktok", "x"]);

app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.static(resolve("public")));

const isNonEmptyString = (value, maxLength = 100) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength;

function formatShortlist(platform, niche, rawData) {
  const platformKey = platform.toLowerCase();
  const hostByPlatform = {
    youtube: ["youtube.com", "www.youtube.com"],
    instagram: ["instagram.com", "www.instagram.com"],
    tiktok: ["tiktok.com", "www.tiktok.com"],
    x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  };
  const profilePatternByPlatform = {
    youtube:
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_.-]+)/gi,
    instagram:
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/gi,
    tiktok: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/gi,
    x: /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+/gi,
  };
  const pattern = profilePatternByPlatform[platformKey];
  if (!pattern) {
    return [];
  }
  if (
    platformKey === "instagram" &&
    rawData &&
    typeof rawData === "object" &&
    !Array.isArray(rawData) &&
    typeof rawData.username === "string"
  ) {
    const username = rawData.username.replace(/^@/, "");
    const name =
      rawData.full_name ||
      rawData.fullName ||
      rawData.name ||
      username;
    const profile = {
      name,
      handle: "@" + username,
      platform: "INSTAGRAM",
      profileUrl: "https://instagram.com/" + username,
      outreachDraft:
        "Hi " +
        name +
        ", I found your public INSTAGRAM profile while researching " +
        niche +
        " creators. Would you be open to discussing a potential brand collaboration?",
    };
    const followers =
      rawData.followers ??
      rawData.followers_count ??
      rawData.follower_count ??
      rawData.edge_followed_by?.count;
    if (followers !== undefined && followers !== null) {
      profile.followers = followers;
    }
    return [profile];
  }

  if (platformKey === "x" && Array.isArray(rawData?.timeline)) {
    const profiles = new Map();
    for (const item of rawData.timeline) {
      const user = item?.user_info;
      const username = user?.screen_name;
      if (typeof username !== "string" || !username.trim()) {
        continue;
      }
      const handle = username.replace(/^@/, "");
      const profileUrl = `https://x.com/${handle}`;
      if (profiles.has(profileUrl)) {
        continue;
      }
      const name = user.name || handle;
      const profile = {
        name,
        handle: `@${handle}`,
        platform: "X",
        profileUrl,
        outreachDraft: `Hi ${name}, I found your public X profile while researching ${niche} creators. Would you be open to discussing a potential brand collaboration?`,
      };
      if (user.followers_count !== undefined && user.followers_count !== null) {
        profile.followers = user.followers_count;
      }
      profiles.set(profileUrl, profile);
      if (profiles.size >= 5) {
        break;
      }
    }
    return [...profiles.values()];
  }

  const texts = [];
  const records = [];
  const visited = new WeakSet();
  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) {
      return;
    }
    if (typeof value === "string") {
      texts.push(value);
      return;
    }
    if (typeof value !== "object" || visited.has(value)) {
      return;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    records.push(value);
    for (const child of Object.values(value)) {
      visit(child, depth + 1);
    }
  };
  visit(rawData);

  const profiles = new Map();
  const addProfile = (rawUrl, record = {}) => {
    const handleValue =
      record.username ||
      record.handle ||
      record.screen_id ||
      record.unique_id ||
      record.channel_id ||
      record.channelId ||
      (platformKey === "youtube" &&
      typeof record.id === "string" &&
      record.id.startsWith("UC")
        ? record.id
        : undefined);
    if ((!rawUrl || typeof rawUrl !== "string") && handleValue) {
      const handle = String(handleValue).replace(/^@/, "");
      const path =
        platformKey === "youtube"
          ? record.channel_id || record.channelId || String(handleValue).startsWith("UC")
            ? `/channel/${handle}`
            : `/@${handle}`
          : platformKey === "tiktok"
            ? `/@${handle}`
            : `/${handle}`;
      rawUrl = `https://${platformKey === "x" ? "x.com" : `${platformKey}.com`}${path}`;
    }
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      return;
    }
    let url;
    try {
      const candidateUrl = rawUrl.trim().replace(/[),.;]+$/, "");
      url = new URL(
        candidateUrl.startsWith("http")
          ? candidateUrl
          : `https://${candidateUrl.replace(/^\/+/, "")}`,
      );
    } catch {
      return;
    }
    if (!hostByPlatform[platformKey].includes(url.hostname.toLowerCase())) {
      return;
    }

    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") {
      return;
    }
    if (
      platformKey === "youtube" &&
      !/^\/(?:@[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_.-]+|user\/[A-Za-z0-9_.-]+)$/.test(
        path,
      )
    ) {
      return;
    }
    url.search = "";
    url.hash = "";
    const profileUrl = url.toString().replace(/\/$/, "");
    if (profiles.has(profileUrl)) {
      return;
    }

    const handle =
      record.username ||
      record.handle ||
      record.screen_id ||
      (platformKey === "youtube"
        ? path.split("/").filter(Boolean).join("/")
        : path.split("/").filter(Boolean)[0]);
    const name =
      record.name ||
      record.author ||
      record.title ||
      record.fullname ||
      record.full_name ||
      record.fullName ||
      record.displayName ||
      record.channel_title ||
      record.channelTitle ||
      record.channel_name ||
      record.channelName ||
      record.nickname ||
      handle;
    if (!handle || !name) {
      return;
    }

    const profile = {
      name,
      handle: String(handle).startsWith("@") ? String(handle) : `@${handle}`,
      platform: platform.toUpperCase(),
      profileUrl,
      outreachDraft: `Hi ${name}, I found your public ${platform.toUpperCase()} profile while researching ${niche} creators. Would you be open to discussing a potential brand collaboration?`,
    };
    const followers =
      record.followers ??
      record.subscriberCount ??
      record.subscriber_count ??
      record.follower_count ??
      record.followers_count ??
      record.followerCount ??
      record.edge_followed_by?.count;
    if (followers !== undefined && followers !== null) {
      profile.followers = followers;
    }
    const engagement = record.engagement ?? record.engagementRate;
    if (engagement !== undefined && engagement !== null) {
      profile.engagementRate = engagement;
    }
    if (typeof record.fitScore === "number" && Number.isFinite(record.fitScore)) {
      profile.fitScore = record.fitScore;
    }
    profiles.set(profileUrl, profile);
  };

  for (const record of records) {
    addProfile(
      record.profileUrl ||
        record.profile_url ||
        record.url ||
        record.link ||
        record.channelUrl ||
        record.channel_url,
      record,
    );
  }
  for (const text of texts) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      addProfile(match[0]);
    }
  }

  return [...profiles.values()].slice(0, 5);
}

app.post("/api/scout", async (request, response) => {
  const {
    niche = "skincare",
    platform = "YouTube",
    budget = 300,
    max_research_spend: maxResearchSpend = 1,
    instagram_handle: instagramHandle,
  } = request.body ?? {};

  if (!isNonEmptyString(niche)) {
    return response.status(400).json({
      success: false,
      error: "niche must be a non-empty string of at most 100 characters",
    });
  }
  if (!isNonEmptyString(platform)) {
    return response.status(400).json({
      success: false,
      error: "platform must be a non-empty string of at most 100 characters",
    });
  }
  if (!SUPPORTED_PLATFORMS.has(platform.trim().toLowerCase())) {
    return response.status(400).json({
      success: false,
      error: "platform must be YouTube, Instagram, TikTok, or X",
    });
  }
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
    return response.status(400).json({
      success: false,
      error: "budget must be a positive finite number",
    });
  }
  if (
    typeof maxResearchSpend !== "number" ||
    !Number.isFinite(maxResearchSpend) ||
    maxResearchSpend <= 0
  ) {
    return response.status(400).json({
      success: false,
      error: "max_research_spend must be a positive finite number",
    });
  }
  if (maxResearchSpend > budget) {
    return response.status(400).json({
      success: false,
      error: "max_research_spend cannot exceed the campaign budget",
    });
  }
  if (
    platform.trim().toLowerCase() === "instagram" &&
    !isNonEmptyString(instagramHandle, 64)
  ) {
    return response.status(400).json({
      success: false,
      error:
        "instagram_handle must be a non-empty public Instagram username of at most 64 characters",
    });
  }

  console.info(
    `[Scout API] New request: ${niche.trim()} | ${platform.trim()} | spend cap $${maxResearchSpend}`,
  );

  try {
    const jobResult = await executeBuyScoutJob({
      platform: platform.trim(),
      niche: niche.trim(),
      limit: 5,
      maxSpendUsd: maxResearchSpend,
      creatorHandle:
        typeof instagramHandle === "string"
          ? instagramHandle.trim().replace(/^@/, "")
          : undefined,
    });
    const shortlist = formatShortlist(
      platform.trim(),
      niche.trim(),
      jobResult.rawData,
    );

    return response.json({
      success: true,
      campaign: {
        niche: niche.trim(),
        platform: platform.trim().toUpperCase(),
        totalBudget: budget,
        maxResearchSpend,
      },
      shortlist,
      buyRawData: jobResult.rawData,
      proof: {
        teamTag: jobResult.teamTag,
        useBuyEndpoint: jobResult.targetUrl,
        celoTransactionHash: jobResult.txHash,
      },
    });
  } catch (error) {
    console.error("[Scout API Error]:", error);
    const isSpendCapError =
      error instanceof Error &&
      /spend cap|spendcontrols|exceeds the configured research spend cap/i.test(
        error.message,
      );
    return response.status(isSpendCapError ? 422 : 502).json({
      success: false,
      error: isSpendCapError ? "Spend Cap Exceeded" : "Scout Execution Failed",
      message: error instanceof Error ? error.message : "Unknown scout error",
    });
  }
});

app.use((error, request, response, next) => {
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({
      success: false,
      error: "Request body must be valid JSON",
    });
  }
  if (error?.type === "entity.too.large") {
    return response.status(413).json({
      success: false,
      error: "Request body exceeds the 16kb limit",
    });
  }

  console.error("[Scout API Error]:", error);
  return response.status(500).json({
    success: false,
    error: "Internal Server Error",
  });
});

export { app, formatShortlist };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  app.listen(PORT, () => {
    console.info(`CreatorScout AI running on http://localhost:${PORT}`);
  });
}
