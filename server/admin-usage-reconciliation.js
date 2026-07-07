import { CREDITS_PER_USD } from './credits-math.js';
import { listUsageEventsForAdmin } from './usage-billing-store.js';
import { listActiveCatalog } from './price-catalog-store.js';

function imageFloorCredits(entry) {
  if (!entry) return null;
  if (entry.userCreditsPerUnit != null && Number.isFinite(Number(entry.userCreditsPerUnit))) {
    return Math.floor(Number(entry.userCreditsPerUnit));
  }
  const per = entry.perUnit != null ? Number(entry.perUnit) : null;
  if (per != null && Number.isFinite(per) && per > 0) {
    return Math.ceil(per * CREDITS_PER_USD);
  }
  return null;
}

/**
 * @param {{ from?: string, to?: string }} query
 */
export async function buildUsageReconciliationSummary(query = {}) {
  const [{ events }, catalog] = await Promise.all([
    listUsageEventsForAdmin({ ...query, limit: 10000 }),
    listActiveCatalog(),
  ]);
  const catalogBySku = new Map(catalog.map((entry) => [entry.billingSku, entry]));
  const bySku = new Map();

  for (const ev of events) {
    const billingSku = String(ev.billingSku || 'unknown').trim() || 'unknown';
    if (!bySku.has(billingSku)) {
      bySku.set(billingSku, {
        billingSku,
        eventCount: 0,
        creditsCharged: 0,
        costUsdEst: 0,
      });
    }
    const row = bySku.get(billingSku);
    row.eventCount += 1;
    row.creditsCharged += Number(ev.creditsCharged) || 0;
    if (ev.costUsdEst != null && Number.isFinite(Number(ev.costUsdEst))) {
      row.costUsdEst += Number(ev.costUsdEst);
    }
  }

  const rows = [...bySku.values()].map((row) => {
    const creditsFromUsd = Math.round(row.costUsdEst * CREDITS_PER_USD);
    const variancePct =
      creditsFromUsd > 0
        ? (Math.abs(row.creditsCharged - creditsFromUsd) / creditsFromUsd) * 100
        : null;
    const avgCreditsPerEvent = row.eventCount > 0 ? row.creditsCharged / row.eventCount : 0;
    const entry = catalogBySku.get(row.billingSku);
    const floor = row.billingSku.startsWith('image.') ? imageFloorCredits(entry) : null;
    const highVariance = variancePct != null && variancePct > 5;
    const belowImageFloor = floor != null && avgCreditsPerEvent < floor;
    const flagReasons = [];
    if (highVariance) flagReasons.push('variance>5%');
    if (belowImageFloor) flagReasons.push('avgBelowImageFloor');

    return {
      billingSku: row.billingSku,
      displayName: entry?.displayName ?? null,
      eventCount: row.eventCount,
      creditsCharged: row.creditsCharged,
      costUsdEst: Math.round(row.costUsdEst * 1e6) / 1e6,
      creditsFromUsd,
      variancePct: variancePct != null ? Math.round(variancePct * 100) / 100 : null,
      avgCreditsPerEvent: Math.round(avgCreditsPerEvent * 100) / 100,
      imageFloor: floor,
      flagged: highVariance || belowImageFloor,
      flagReasons,
    };
  });

  rows.sort((a, b) => b.creditsCharged - a.creditsCharged);

  return {
    from: query.from || null,
    to: query.to || null,
    eventCount: events.length,
    rows,
  };
}
