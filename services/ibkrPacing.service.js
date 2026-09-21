// STEP 4 SIMPLIFIED: one request budget shared by this running Node process.
// Multiple backend processes would need a shared limiter.
import { performance } from 'node:perf_hooks';

const MAX_REQUESTS_PER_SECOND = 10;
const MAX_HISTORY_REQUESTS_PER_MINUTE = 50;

let recentRequests = [];
let recentHistoryRequests = [];
let blockedUntil = 0;

export function checkRequestLimit(path) {
  const now = performance.now();
  const endpoint = path.split('?')[0];
  const isHistoryRequest = endpoint === '/iserver/marketdata/history';

  // Discard attempts that no longer count against the rolling windows.
  recentRequests = recentRequests.filter((requestTime) => now - requestTime < 1000);
  recentHistoryRequests = recentHistoryRequests.filter((requestTime) => now - requestTime < 60_000);

  let waitMilliseconds = Math.max(0, blockedUntil - now);
  if (recentRequests.length >= MAX_REQUESTS_PER_SECOND) {
    const globalLimitExpiresAt = recentRequests[0] + 1000;
    waitMilliseconds = Math.max(waitMilliseconds, globalLimitExpiresAt - now);
  }
  if (isHistoryRequest && recentHistoryRequests.length >= MAX_HISTORY_REQUESTS_PER_MINUTE) {
    const historyLimitExpiresAt = recentHistoryRequests[0] + 60_000;
    waitMilliseconds = Math.max(waitMilliseconds, historyLimitExpiresAt - now);
  }

  if (waitMilliseconds > 0) {
    const error = new Error('IBKR request limit reached. Please retry later.');
    error.statusCode = 429;
    error.retryAfter = Math.max(1, Math.ceil(waitMilliseconds / 1000));
    throw error;
  }

  // No await between checking and recording: concurrent calls cannot bypass the check.
  // Failed outgoing attempts count; locally rejected requests do not.
  recentRequests.push(now);
  if (isHistoryRequest) recentHistoryRequests.push(now);
}

export function blockRequests(seconds) {
  const requestedBlockEnd = performance.now() + seconds * 1000;
  // A later response must not shorten an existing cooldown.
  blockedUntil = Math.max(blockedUntil, requestedBlockEnd);
}
