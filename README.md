# CreatorScout AI

> **Track:** Build with Buy  
> **Team Tag:** `celo_07fa06ecd2c7`  
> **Workshop:** [Celo Build with Buy](https://www.youtube.com/live/w1A_mP3r8aQ)

CreatorScout AI is a prototype creator-research API. It routes a niche search to a Buy social-data tool, pays for the request through x402 on Celo, and ranks returned creator records with simple relevance and engagement heuristics.

## Platform tools

| Platform | Buy tool endpoint |
| --- | --- |
| YouTube | `https://gateway.usebuy.ai/v1/social/youtube/videos/search` |
| Instagram | `https://gateway.usebuy.ai/v1/social/instagram/profile` |
| TikTok | `https://gateway.usebuy.ai/v1/social/tiktok/tools/apify-apidojo-tiktok-scraper` |
| X | `https://gateway.usebuy.ai/v1/social/x/posts/search` |

## Requirements

- Node.js 20 or newer.
- A Celo Mainnet wallet with enough USDC for the selected Buy request.
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
  -d '{"niche":"skincare","platform":"YouTube","budget":300,"max_research_spend":1.00}'
```

Fields:

- `niche`: required non-empty search phrase, up to 100 characters.
- `platform`: `YouTube`, `Instagram`, `TikTok`, or `X`.
- `budget`: positive campaign budget in USD; records with a reported creator rate above it are excluded.
- `max_research_spend`: positive per-request research spend in USD; cannot exceed `budget`.
- `instagram_handle`: required for Instagram; a public username, with or without `@`.

Each request uses the current gateway schema for its platform: YouTube searches public videos and extracts the associated creator channels; Instagram enriches a supplied public handle; TikTok searches relevant videos and extracts their authors; and X searches public posts and extracts their author profiles. The tool performs an x402 payment on Celo USDC; both x402 v1 (`celo`) and v2 (`eip155:42220`) payment challenges are supported.

The response includes `success`, campaign details, a normalized `shortlist`, the raw Buy result, and payment `proof` metadata. Shortlist fields are extracted from Buy's returned public data and should be reviewed before contacting a creator or making a campaign decision.

`proof.useBuyEndpoint` is the exact Buy endpoint used. `proof.celoTransactionHash` carries Buy's transaction identifier when returned. CreatorScout never falls back from a failed social-data request to another paid service, so a request cannot silently buy unrelated compute or risk a second charge.

Invalid request data returns HTTP 400. If the Buy call fails or exceeds the spend cap, the API returns an error response and does not return a shortlist.

## Implementation notes

- `buy.js` routes platforms to the current Buy gateway tools and uses the official `@x402/fetch` payment wrapper with `@x402/evm` and viem. The installed SDK does not export a `fetchWithX402` function; `buy.js` builds the equivalent wrapper using its supported API.
- Payments are limited to Celo USDC, and the x402 client applies the caller's per-request spend cap.
- Do not treat returned social metrics as independently verified. Follow each provider's terms and applicable privacy rules.
- No settlement URL is included unless the service returns a transaction hash. The file `proof/celoscan_txs.txt` contains a placeholder, not evidence of a completed payment.
