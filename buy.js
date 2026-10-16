import { randomBytes } from "node:crypto";
import { wrapFetchWithPayment, x402Client as X402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

const PLATFORM_ENDPOINTS = {
  youtube: "https://gateway.usebuy.ai/v1/social/youtube/videos/search",
  instagram: "https://gateway.usebuy.ai/v1/social/instagram/profile",
  tiktok: "https://gateway.usebuy.ai/v1/social/tiktok/tools/apify-apidojo-tiktok-scraper",
  x: "https://gateway.usebuy.ai/v1/social/x/posts/search"
};

const CELO_USDC_ADDRESS = getAddress(
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
);
const BUY_REQUEST_TIMEOUT_MS = 120_000;
const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const usdToAtomic = (amount) => {
  const [coefficient, exponentText] = amount.toString().toLowerCase().split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const decimalShift = 6 + exponent - fraction.length;
  return decimalShift >= 0
    ? digits * 10n ** BigInt(decimalShift)
    : digits / 10n ** BigInt(-decimalShift);
};

class CeloExactV1Client {
  scheme = "exact";

  constructor(account, maxAmountAtomic) {
    this.account = account;
    this.maxAmountAtomic = BigInt(maxAmountAtomic);
  }

  async createPaymentPayload(x402Version, requirements) {
    if (requirements.network !== "celo" || requirements.scheme !== "exact") {
      throw new Error("Buy returned an unsupported payment network or scheme");
    }
    if (getAddress(requirements.asset) !== CELO_USDC_ADDRESS) {
      throw new Error("CreatorScout only authorizes Celo USDC payments");
    }

    const amount = BigInt(requirements.maxAmountRequired);
    if (amount > this.maxAmountAtomic) {
      throw new Error(
        "Buy's quoted payment exceeds the configured research spend cap",
      );
    }
    if (!requirements.extra?.name || !requirements.extra?.version) {
      throw new Error("Buy payment quote is missing the USDC EIP-712 domain");
    }

    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: this.account.address,
      to: getAddress(requirements.payTo),
      value: requirements.maxAmountRequired,
      validAfter: String(now - 600),
      validBefore: String(now + requirements.maxTimeoutSeconds),
      nonce: `0x${randomBytes(32).toString("hex")}`,
    };
    const signature = await this.account.signTypedData({
      domain: {
        name: requirements.extra.name,
        version: requirements.extra.version,
        chainId: celo.id,
        verifyingContract: getAddress(requirements.asset),
      },
      types: EIP712_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });

    return {
      x402Version,
      scheme: requirements.scheme,
      network: requirements.network,
      payload: { authorization, signature },
    };
  }
}

const createRequestBody = (platform, niche, limit, creatorHandle) => {
  switch (platform) {
    case "youtube":
      return { query: niche };
    case "instagram":
      return { username: creatorHandle };
    case "tiktok":
      return {
        body: {
          keywords: [niche],
          sortType: "RELEVANCE",
          includeSearchKeywords: true,
        },
        maxResults: limit,
      };
    case "x":
      return { query: niche, type: "latest" };
    default:
      throw new Error(`Unsupported Buy platform: ${platform}`);
  }
};

export async function executeBuyScoutJob({
  platform = "youtube",
  niche = "skincare",
  limit = 5,
  maxSpendUsd = 1,
  creatorHandle,
}) {
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
    throw new TypeError("maxSpendUsd must be a positive finite number");
  }

  const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
  
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org"),
  });
  const rpcUrl = process.env.CELO_RPC_URL || "https://forno.celo.org";
  const maxAmountAtomic = usdToAtomic(maxSpendUsd).toString();
  const x402Client = new X402Client()
    .setSpendControls({
      allowedAssets: [
        {
          network: "celo",
          asset: CELO_USDC_ADDRESS,
          maxAmountPerPayment: maxAmountAtomic,
        },
        {
          network: `eip155:${celo.id}`,
          asset: CELO_USDC_ADDRESS,
          maxAmountPerPayment: maxAmountAtomic,
        },
      ],
    })
    .register(
      `eip155:${celo.id}`,
      new ExactEvmScheme(walletClient.account, { rpcUrl }),
    )
    .registerV1(
      "celo",
      new CeloExactV1Client(account, maxAmountAtomic),
    );
  const fetchWithX402 = wrapFetchWithPayment(fetch, x402Client);

  const selectedPlatform = platform.toLowerCase();
  let targetUrl = PLATFORM_ENDPOINTS[selectedPlatform] || PLATFORM_ENDPOINTS.youtube;

  const payload = createRequestBody(
    selectedPlatform,
    niche,
    limit,
    creatorHandle,
  );

  console.log(`[Buy Agent] Requesting ${selectedPlatform.toUpperCase()} data via ${targetUrl}...`);

  const abortController = new AbortController();
  let response;
  try {
    const paidRequest = fetchWithX402(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
    const requestTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        abortController.abort();
        reject(
          new Error(
            "Buy request timed out after 120 seconds; payment status is unknown, so it was not retried.",
          ),
        );
      }, BUY_REQUEST_TIMEOUT_MS);
    });
    response = await Promise.race([paidRequest, requestTimeout]);
  } catch (error) {
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Buy service error (${response.status}): ${errText}`);
  }

  const gatewayResponse = await response.json();
  const rawData = gatewayResponse?.output ?? gatewayResponse;
  const txHash =
    response.headers.get("x-402-settlement-tx") ||
    response.headers.get("x-payment-tx-hash") ||
    response.headers.get("x-settlement-tx") ||
    response.headers.get("x-transaction-hash") ||
    gatewayResponse?.transaction ||
    gatewayResponse?.txHash ||
    gatewayResponse?.transactionHash ||
    null;

  return {
    platform: selectedPlatform,
    rawData,
    txHash,
    targetUrl
  };
}
