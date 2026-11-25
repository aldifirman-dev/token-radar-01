/** Snapshot-only scoring and farm-plan generation for the token radar. */

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_steps: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -80,
  growth_cap: 200,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_steps: 5,
};

export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 24;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const bySlug = (a: { slug: string }, b: { slug: string }): number =>
  a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  const to = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor
    + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainSteps = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_steps);
  const chainMult = 1 + model.chain_step * chainSteps;
  const implied = Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * chainMult);
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null || age >= 365) return 30;
  if (age < 180) return 60;
  return 45;
}

function categoryGroup(p: SnapshotProtocol): string {
  const category = (p.category ?? '').toLowerCase();
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) return 'lending';
  if (category.includes('dex') || category.includes('yield') || category.includes('farm')) return 'dex';
  if (category.includes('bridge')) return 'bridge';
  if (category.includes('stake') || category.includes('restak')) return 'staking';
  if (category.includes('perpetual') || category.includes('derivative')) return 'perps';
  if (category.includes('prediction')) return 'prediction';
  if (category.includes('curator') || category.includes('allocator') || category.includes('vault')) return 'vault';
  if (category.includes('stable')) return 'stable';
  if (category.includes('rwa')) return 'rwa';
  if (category.includes('insurance')) return 'insurance';
  return 'general';
}

function planActions(group: string, capital: number, chain: string, nextChain: string): [string, string, string] {
  const main: Record<string, string> = {
    lending: `Supply $${capital} of USDC on ${chain} and leave the lending position open.`,
    dex: `Add about $${capital} in balanced assets to a liquid pool on ${chain}.`,
    bridge: `Bridge $${capital} in stablecoins from ${chain} to ${nextChain} using the protocol's app.`,
    staking: `Stake $${capital} of the chain's native asset on ${chain} and keep the receipt.`,
    perps: `Deposit $${capital} of stablecoin margin on ${chain} and open one small, hedged position.`,
    prediction: `Fund a wallet with $${capital} on ${chain} and take one small position in an active market.`,
    vault: `Deposit $${capital} into a strategy vault on ${chain} and keep the share receipt.`,
    stable: `Mint or deposit $${capital} of a supported stable asset on ${chain}.`,
    rwa: `Subscribe with $${capital} to a supported on-chain yield asset on ${chain}.`,
    insurance: `Buy a small policy with up to $${capital} of cover on ${chain}.`,
    general: `Make a small $${capital} deposit or primary on-chain action on ${chain}.`,
  };
  const second: Record<string, string> = {
    lending: 'Borrow a small amount against the position, then repay it after confirming the balance.',
    dex: 'Make a small swap through a different pool route, then check the receipt in the wallet.',
    bridge: `Send a second small transfer back from ${nextChain} to ${chain} and confirm both sides.`,
    staking: 'Claim or restake a small available reward and verify the receipt balance.',
    perps: 'Place and cancel a small limit order, then confirm the account has no unintended exposure.',
    prediction: 'Close or settle a small market position and verify the resulting balance.',
    vault: 'Withdraw a small fraction of shares and deposit it again after checking the preview.',
    stable: 'Swap a small amount between two supported stable assets and verify the quote and receipt.',
    rwa: 'Review and claim a distribution if available, then verify the asset balance on-chain.',
    insurance: 'Buy a minimal additional coverage position and confirm its on-chain policy record.',
    general: 'Complete a second low-value app interaction and verify its transaction receipt.',
  };
  const followup: Record<string, string> = {
    lending: 'If governance is enabled, review an active proposal and cast a vote from the same wallet.',
    dex: 'Stake the liquidity receipt in the pool gauge if one is available, then record the position.',
    bridge: `Re-bridge a small amount to ${nextChain} on a later day and verify the destination receipt.`,
    staking: 'Add a small amount to the stake or restake position and keep the updated receipt.',
    perps: 'Return on another day to adjust or close the hedge and review the account history.',
    prediction: 'Return on a later day to take or settle another small position in a distinct market.',
    vault: 'Return later to review the strategy and make a small additional deposit if terms still fit.',
    stable: 'Repeat a small swap on a later day and compare the received amount with the earlier quote.',
    rwa: 'Return on a later day to check the asset statement and claim a distribution if offered.',
    insurance: 'Review active coverage and renew only if the published terms still match the need.',
    general: 'Check the official community page for a testnet role tied to this on-chain activity.',
  };
  return [main[group] ?? main.general!, second[group] ?? second.general!, followup[group] ?? followup.general!];
}

function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const chain = p.chains[0] ?? 'the primary network';
  const nextChain = p.chains[1] ?? 'another supported network';
  const [mainAction, secondAction, followup] = planActions(categoryGroup(p), capital, chain, nextChain);
  const steps: [string, string, string][] = [
    ['Create a fresh wallet for this activity and keep its seed phrase offline, separate from daily funds.', 'No capital at risk; under $3 network fee', '5 minutes'],
    [mainAction, `$${capital} working capital plus about $${capital >= 150 ? 8 : 4} network fees`, '15-25 minutes'],
    [secondAction, 'About $2-5 for a small on-chain action', '10-20 minutes'],
    ['Complete one qualifying action each week, vary the action when useful, and save each transaction receipt.', 'About $2-5 network fees per week', '10 minutes weekly'],
    [`Keep the position active for at least ${hold} days; check exposure and fees before adding more capital.`, `Keep up to $${capital} deployed; opportunity cost varies`, `${hold} days minimum`],
    ["Before withdrawing, open the protocol's own points or rewards page from its verified app and check eligibility.", 'No fee to check; do not pay to claim', '10 minutes before exit'],
    [followup, 'About $2-5 if an on-chain transaction is needed', '10-20 minutes'],
    ['Record the wallet, dates, amounts, transaction links, fees, and any reward status in a private farm log.', 'No cost beyond the log', '5 minutes to update'],
  ];
  return steps.map(([action, cost, time]) => `${action} Cost: ${cost}. Time: ${time}.`);
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) chosen.set(slug, protocol);
  }
  for (const protocol of snapshot.protocols) {
    if (!chosen.has(protocol.slug) && protocol.tvl_usd < snapshot.floor_usd && isRankable(protocol)) {
      chosen.set(protocol.slug, protocol);
    }
  }

  const scored = [...chosen.values()].map((protocol) => ({
    protocol,
    ...impliedValue(protocol, snapshot.as_of, model),
  }));
  scored.sort((a, b) => b.implied - a.implied || bySlug(a.protocol, b.protocol));

  let previousValue = Number.POSITIVE_INFINITY;
  return scored.map((score, i) => {
    // Rounding can collide; preserve the model order while making displayed ranks strictly distinct.
    const implied = Math.min(score.implied, previousValue - 1);
    previousValue = implied;
    return {
      rank: i + 1,
      slug: score.protocol.slug,
      name: score.protocol.name,
      category: score.protocol.category,
      chains: score.protocol.chains,
      tvl_usd: score.protocol.tvl_usd,
      change_7d: score.protocol.change_7d,
      mcap_usd: score.protocol.mcap_usd,
      listed_at: score.protocol.listed_at,
      gecko_id: score.protocol.gecko_id,
      symbol: score.protocol.symbol,
      token_status: 'pre-token',
      age_days: score.age,
      implied_value_usd: implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: score.growthPct,
        growth_multiplier: round4(score.growthMult),
        maturity_multiplier: round4(score.maturityMult),
        chain_multiplier: round4(score.chainMult),
        age_days: score.age,
      },
      farm_steps: farmSteps(score.protocol, score.age),
    };
  });
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((row) => !watchlist.has(row.slug)).length;
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model,
      model_version: MODEL_VERSION,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: early,
      live_size: live.length,
      rows: board.map((row) => radarRow(row, watchlist)),
      live,
    },
  };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((slug) => typeof slug !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');

  const protocols = o.protocols.map((value, i): SnapshotProtocol => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `rank ${i + 1} is ${row.rank}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (i > 0 && row.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not have a strictly lower implied value than row ${i}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
      if (!/ Cost: .+\. Time: .+\.$/.test(step)) return `${row.slug} has a farm step without a cost and time`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
