# CreatorScout AI

> **Track:** Build with Buy · **Team Tag:** `celo_07fa06ecd2c7`
>
> **Live demo:** [creatorscoutai.online](https://creatorscoutai.online) · **Demo video:** [Watch on YouTube](https://youtu.be/94BKDnjzZ2Q)
> **Workshop:** [Celo Build with Buy](https://www.youtube.com/live/w1A_mP3r8aQ)
> **Video Demo:** https://youtu.be/94BKDnjzZ2Q

CreatorScout AI is a deployed creator-research app for discovering public profiles on YouTube, Instagram, TikTok, and X. It routes a campaign brief to Buy social-data tools, pays for live research through x402 on Celo, and returns a shortlist with editable outreach messages.

## Try it

1. Open [creatorscoutai.online](https://creatorscoutai.online) on any device.
2. Use **Explore demo results** to inspect the full product without a payment.
3. For a live scout, connect a Celo wallet funded with at least **0.04 USDC** and confirm the displayed USDC transfer.
4. CreatorScout verifies that payment on Celo, then its server-side agent pays the matching Buy endpoint and returns the creator shortlist with both CeloScan receipts.

Each live scout needs one wallet transaction: the user pays exactly 0.04 Celo USDC to the CreatorScout agent wallet. The agent wallet never accesses the user's wallet or asks for a token approval. It pays Buy separately through x402 after the customer payment is confirmed.

## Celo verification

CreatorScout does not deploy a custom smart contract. It uses Buy’s x402 payment flow with Celo mainnet USDC at [`0xcebA9300f2b948710d2653dD7B07f33A8B32118C`](https://celoscan.io/token/0xcebA9300f2b948710d2653dD7B07f33A8B32118C).

**CreatorScout agent wallet:** [`0x80Dfdd11bA7ff9D8631c489A623B80A4004c4b88`](https://celoscan.io/address/0x80Dfdd11bA7ff9D8631c489A623B80A4004c4b88)

Verified Buy-backed social research settlements:

| Platform | Sample Celo settlement |
| --- | --- |
| YouTube | [`0x1fba…a47ea`](https://celoscan.io/tx/0x1fbaaaaa79c24f94ffd8432f1109d2deaaaf8f70248c1d22008ac0afd34a47ea) |
| Instagram | [`0x47c4…20a6b`](https://celoscan.io/tx/0x47c48742b9cc11c357f488da7c683b9b1fcf43bb4a6e6f5b2df9e48d76a20a6b) |
| TikTok | [`0xae28…bd0d7`](https://celoscan.io/tx/0xae289176ab2781f5eb04a3d9b4a293389bd3c5a9fbd45a4982d4c6a1f29bd0d7) |
| X | [`0xe43a…f44be`](https://celoscan.io/tx/0xe43a821217f15cbf7cec1bacfe803148e0c635d40216b6a990eb6691632f44be) |

## Platform tools

| Platform | Buy tool endpoint |
| --- | --- |
| YouTube | `https://gateway.usebuy.ai/v1/social/youtube/videos/search` |
| Instagram | `https://gateway.usebuy.ai/v1/social/instagram/profile` |
| TikTok | `https://gateway.usebuy.ai/v1/social/tiktok/tools/apify-apidojo-tiktok-scraper` |
| X | `https://gateway.usebuy.ai/v1/social/x/posts/search` |

## Requirements

- Node.js 20 or newer.
- The server-side agent wallet requires CELO and USDC for Buy x402 requests.
- A browser wallet with 0.04 Celo USDC is required only for a paid live scout. MetaMask is recommended.
- A Celo RPC URL.

Buy payments are real and irreversible. Use a dedicated low-balance wallet. `max_research_spend` is a per-request USDC spend cap; a request whose x402 quote exceeds the cap is rejected before signing.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and configure the wallet key. Never commit `.env` or share the private key.

```dotenv
AGENT_PRIVATE_KEY=0x...
CELO_RPC_URL=https://forno.celo.org
TEAM_TAG=celo_07fa06ecd2c7
PORT=3000
```

Start the API:

```bash
node server.js
```

## API

### `POST /api/scout`

```bash
curl -X POST http://localhost:3000/api/scout \
  -H "Content-Type: application/json" \
  -d '{"niche":"skincare","platform":"YouTube","budget":300,"max_research_spend":0.04,"payment_tx_hash":"0x...","payment_from":"0x..."}'
```

Fields:

- `niche`: required non-empty search phrase, up to 100 characters.
- `platform`: `YouTube`, `Instagram`, `TikTok`, or `X`.
- `budget`: positive campaign budget in USD; records with a reported creator rate above it are excluded.
- `max_research_spend`: positive per-request research spend in USD; cannot exceed `budget`.
- `instagram_handle`: required for Instagram; a public username, with or without `@`.
- `payment_tx_hash`: confirmed Celo USDC transfer transaction, sent from `payment_from` to the CreatorScout agent wallet.
- `payment_from`: connected customer's Celo wallet address.

For a live request, `max_research_spend` is fixed at 0.04 USDC. The server accepts a customer payment only if it is a successful, exact USDC transfer to the derived agent wallet and includes CreatorScout's Celo attribution tag.

Each request uses the current gateway schema for its platform: YouTube searches public videos and extracts the associated creator channels; Instagram enriches a supplied public handle; TikTok searches relevant videos and extracts their authors; and X searches public posts and extracts their author profiles. The tool performs an x402 payment on Celo USDC; both x402 v1 (`celo`) and v2 (`eip155:42220`) payment challenges are supported.

The response includes `success`, campaign details, a normalized `shortlist`, the raw Buy result, and payment `proof` metadata. Shortlist fields are extracted from Buy's returned public data and should be reviewed before contacting a creator or making a campaign decision.

`proof.useBuyEndpoint` is the exact Buy endpoint used. `proof.celoTransactionHash` carries Buy's transaction identifier when returned. CreatorScout never falls back from a failed social-data request to another paid service, so a request cannot silently buy unrelated compute or risk a second charge.

## Public demo controls

The landing page includes **Explore demo results**, which renders example profiles without calling Buy or making a Celo payment. A paid live scout requires a connected Celo wallet and an explicit 0.04 USDC transfer. The server verifies the transfer before it calls Buy.

Invalid request data returns HTTP 400. If the Buy call fails or exceeds the spend cap, the API returns an error response and does not return a shortlist.

## Implementation notes

- `buy.js` routes platforms to the current Buy gateway tools and uses the official `@x402/fetch` payment wrapper with `@x402/evm` and viem. The installed SDK does not export a `fetchWithX402` function; `buy.js` builds the equivalent wrapper using its supported API.
- Customer payments and Buy x402 payments are limited to Celo USDC. The agent's x402 client applies the 0.04 USDC per-request spend cap.
- Do not treat returned social metrics as independently verified. Follow each provider's terms and applicable privacy rules.
- Live results show the customer's verified Celo USDC transfer and the Buy settlement when Buy returns a transaction hash.
