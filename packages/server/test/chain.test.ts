import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { CHAIN_ID, COLLECTION } from "@ruglife/protocol";
import { PILOT_DOMAIN, PILOT_TYPES, verifyPilot, verifySiwe } from "../src/chain.js";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const pilot = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

describe("sign-in (EIP-4361) — offline EOA path", () => {
  it("accepts a correct message and refuses a wrong nonce, domain, chain or signer", async () => {
    const nonce = "abcdefgh12345678";
    const message = createSiweMessage({ address: owner.address, chainId: CHAIN_ID, domain: "ruglife.test", nonce, uri: "https://ruglife.test", version: "1", issuedAt: new Date() });
    const signature = await owner.signMessage({ message });
    expect(await verifySiwe(message, signature, { domain: "ruglife.test", nonce })).toEqual({ ok: true, address: owner.address });
    expect((await verifySiwe(message, signature, { domain: "ruglife.test", nonce: "other" })).ok).toBe(false);
    expect((await verifySiwe(message, signature, { domain: "evil.test", nonce })).ok).toBe(false);
    const wrongChain = createSiweMessage({ address: owner.address, chainId: 1, domain: "ruglife.test", nonce, uri: "https://ruglife.test", version: "1" });
    expect((await verifySiwe(wrongChain, await owner.signMessage({ message: wrongChain }), { domain: "ruglife.test", nonce })).ok).toBe(false);
    const forged = await pilot.signMessage({ message });
    expect((await verifySiwe(message, forged, { domain: "ruglife.test", nonce })).ok).toBe(false);
    const expired = createSiweMessage({ address: owner.address, chainId: CHAIN_ID, domain: "ruglife.test", nonce, uri: "https://ruglife.test", version: "1", expirationTime: new Date(Date.now() - 1000) });
    expect((await verifySiwe(expired, await owner.signMessage({ message: expired }), { domain: "ruglife.test", nonce })).ok).toBe(false);
  });
});

describe("pilot keys (typed data signed by the owner)", () => {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const sign = (o: typeof owner, tokenId: number, p: `0x${string}`, exp: number, nonce: number) => o.signTypedData({ domain: PILOT_DOMAIN, types: PILOT_TYPES, primaryType: "Pilot", message: { collection: COLLECTION, tokenId: BigInt(tokenId), pilot: p, expires: BigInt(exp), nonce: BigInt(nonce) } });
  it("a valid key passes; expiry, a 31-day key, a different token and a forged signer fail", async () => {
    const signature = await sign(owner, 287, pilot.address, expires, 1);
    expect(await verifyPilot({ tokenId: 287, pilot: pilot.address, expires, nonce: 1, signature }, owner.address)).toEqual({ ok: true });
    expect((await verifyPilot({ tokenId: 288, pilot: pilot.address, expires, nonce: 1, signature }, owner.address)).ok).toBe(false);
    expect((await verifyPilot({ tokenId: 287, pilot: pilot.address, expires, nonce: 1, signature }, pilot.address)).ok).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 10;
    expect((await verifyPilot({ tokenId: 287, pilot: pilot.address, expires: past, nonce: 1, signature: await sign(owner, 287, pilot.address, past, 1) }, owner.address))).toMatchObject({ ok: false, reason: "expired" });
    const far = Math.floor(Date.now() / 1000) + 31 * 24 * 3600;
    expect((await verifyPilot({ tokenId: 287, pilot: pilot.address, expires: far, nonce: 1, signature: await sign(owner, 287, pilot.address, far, 1) }, owner.address)).ok).toBe(false);
    const forged = await sign(pilot, 287, pilot.address, expires, 1);
    expect((await verifyPilot({ tokenId: 287, pilot: pilot.address, expires, nonce: 1, signature: forged }, owner.address)).ok).toBe(false);
  });
});
