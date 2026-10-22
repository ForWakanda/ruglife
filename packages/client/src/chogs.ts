// Your Chogs: the wallet's tokens read from the chain, and the one you play as. One store for the lobby, the table and practice.
// 2026-10-22: the pick used to live only in localStorage, so a Chog that had LEFT the wallet was still offered ("not in your wallet")
// and the one still held was never picked by itself. Now a pick that is not in the wallet is replaced by the first Chog there.
import { useEffect, useSyncExternalStore } from "react";
import { useNet } from "./net.js";
import { chogsOf } from "./wallet.js";

const PICK_KEY = "ruglife.chog";

export interface ChogStore {
  address: string | null;
  /** the wallet's Chog Genesis tokenIds; null while reading (or signed out) */
  mine: number[] | null;
  /** the Chog you play as; when signed in it is always one of `mine` (or null when the wallet holds none) */
  pick: number | null;
}

const readPick = (): number | null => { try { const v = localStorage.getItem(PICK_KEY); return v ? Number(v) : null; } catch { return null; } };
const persist = (pick: number | null): void => { try { if (pick === null) localStorage.removeItem(PICK_KEY); else localStorage.setItem(PICK_KEY, String(pick)); } catch { /* private mode */ } };

let st: ChogStore = { address: null, mine: null, pick: readPick() };
const listeners = new Set<() => void>();
function set(patch: Partial<ChogStore>): void {
  st = { ...st, ...patch };
  for (const l of listeners) l();
}
let reading: string | null = null;

function applyMine(ids: number[]): void {
  const pick = st.pick !== null && ids.includes(st.pick) ? st.pick : ids[0] ?? null;
  set({ mine: ids, pick });
  persist(pick);
}
/** Reads the wallet's Chogs for the signed-in address (once per address). */
export function syncChogs(address: string | null): void {
  if (address === st.address) return;
  if (!address) { reading = null; set({ address: null, mine: null }); return; }
  set({ address, mine: null });
  void refreshChogs(address);
}
/** Re-reads the chain for the current wallet: after a refusal ("not in your wallet"), a transfer, a sale. */
export async function refreshChogs(address: string | null = st.address): Promise<number[]> {
  if (!address) return [];
  reading = address;
  try {
    const ids = await chogsOf(address as `0x${string}`);
    if (reading === address) applyMine(ids);
    return ids;
  } catch {
    if (reading === address && st.mine === null) set({ mine: [] });
    return st.mine ?? [];
  }
}
export function setPick(id: number): void { set({ pick: id }); persist(id); }
/** The Chog you play as, for code outside React (practice set-up, a sit from a table page). */
export const pickedChog = (): number | null => st.pick;
export const getChogs = (): ChogStore => st;

export function useMyChogs(): ChogStore {
  const net = useNet();
  useEffect(() => { syncChogs(net.address); }, [net.address]);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => st);
}
