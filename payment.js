import {
  toDataSuffix,
  verifyTx,
} from "@celo/attribution-tags";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

export const CELO_USDC_ADDRESS = getAddress(
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
);
export const CUSTOMER_PAYMENT_TAG = "celo_6e7b9c9d8084";
export const CUSTOMER_PAYMENT_AMOUNT = 40_000n;
export const CUSTOMER_PAYMENT_AMOUNT_USD = "0.04";
const TRANSFER_SELECTOR = "0xa9059cbb";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const publicClient = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org"),
});

export function getProjectWalletAddress() {
  if (!process.env.AGENT_PRIVATE_KEY) {
    return null;
  }
  try {
    return privateKeyToAccount(process.env.AGENT_PRIVATE_KEY).address;
  } catch {
    return null;
  }
}

export function getPaymentConfig() {
  const projectWalletAddress = getProjectWalletAddress();
  if (!projectWalletAddress) {
    return null;
  }

  return {
    network: "Celo Mainnet",
    chainId: celo.id,
    tokenAddress: CELO_USDC_ADDRESS,
    recipientAddress: projectWalletAddress,
    amountAtomic: CUSTOMER_PAYMENT_AMOUNT.toString(),
    amountUsd: CUSTOMER_PAYMENT_AMOUNT_USD,
    attributionTag: CUSTOMER_PAYMENT_TAG,
    attributionSuffix: toDataSuffix(CUSTOMER_PAYMENT_TAG),
  };
}

export function parseTransferCall(input) {
  if (
    typeof input !== "string" ||
    !input.startsWith(TRANSFER_SELECTOR) ||
    input.length < 138 ||
    !/^0x[0-9a-fA-F]+$/.test(input)
  ) {
    return null;
  }

  const recipientWord = input.slice(10, 74);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(recipientWord)) {
    return null;
  }

  return {
    recipientAddress: getAddress(`0x${recipientWord.slice(-40)}`),
    amount: BigInt(`0x${input.slice(74, 138)}`),
  };
}

function logMatchesPayment(log, from, to) {
  if (
    getAddress(log.address) !== CELO_USDC_ADDRESS ||
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
    !log.topics[1] ||
    !log.topics[2]
  ) {
    return false;
  }

  const sender = getAddress(`0x${log.topics[1].slice(-40)}`);
  const recipient = getAddress(`0x${log.topics[2].slice(-40)}`);
  return (
    sender === from &&
    recipient === to &&
    BigInt(log.data) === CUSTOMER_PAYMENT_AMOUNT
  );
}

export async function verifyCustomerPayment({ transactionHash, senderAddress }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error("A valid Celo payment transaction hash is required");
  }
  if (!isAddress(senderAddress)) {
    throw new Error("A valid customer wallet address is required");
  }

  const recipientAddress = getProjectWalletAddress();
  if (!recipientAddress) {
    throw new Error("The agent wallet is not configured correctly");
  }

  const hash = transactionHash;
  const sender = getAddress(senderAddress);
  const transaction = await publicClient.getTransaction({ hash });
  if (!transaction) {
    throw new Error("The customer payment transaction was not found on Celo");
  }
  if (getAddress(transaction.from) !== sender) {
    throw new Error("The payment transaction sender does not match your wallet");
  }
  if (!transaction.to || getAddress(transaction.to) !== CELO_USDC_ADDRESS) {
    throw new Error("The payment must be a Celo USDC transfer");
  }

  const transfer = parseTransferCall(transaction.input);
  if (
    !transfer ||
    transfer.recipientAddress !== recipientAddress ||
    transfer.amount !== CUSTOMER_PAYMENT_AMOUNT
  ) {
    throw new Error(
      "The payment must send exactly 0.04 USDC directly to the project wallet",
    );
  }

  const attribution = await verifyTx({ client: publicClient, hash });
  if (!attribution?.codes.includes(CUSTOMER_PAYMENT_TAG)) {
    throw new Error(
      `The customer payment is missing the ${CUSTOMER_PAYMENT_TAG} attribution tag`,
    );
  }

  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("The customer payment transaction did not succeed");
  }
  if (
    !receipt.logs.some((log) => logMatchesPayment(log, sender, recipientAddress))
  ) {
    throw new Error(
      "The confirmed USDC transfer does not match the required payment",
    );
  }

  return {
    transactionHash: hash,
    senderAddress: sender,
    recipientAddress,
    amountAtomic: transfer.amount.toString(),
    attributionTag: CUSTOMER_PAYMENT_TAG,
  };
}
