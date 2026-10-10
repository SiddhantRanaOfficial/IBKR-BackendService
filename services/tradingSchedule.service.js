// Returns scheduled intervals, not real-time market status.
// an unexpected trading halt could interrupt the scheduled session.
// The service returns scheduled trading periods, not a live “market is open” signal.
function malformedResponse() {
  const error = new Error('Unexpected IBKR trading schedule response');
  error.statusCode = 502;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw malformedResponse();
  return value.trim() || null;
}

function dateLabel(value) {
  if (!/^\d{8}$/.test(value)) throw malformedResponse();
  const label = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${label}T00:00:00.000Z`);
  // Checks for invalid dates like Feb 30.
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== label) {
    throw malformedResponse();
  }
  // Keep IBKR's trading-date label; overnight intervals can start a day earlier.
  return label;
}

function epochMilliseconds(value) {
  if (!Number.isSafeInteger(value)) throw malformedResponse();
  const milliseconds = value * 1000;
  if (!Number.isSafeInteger(milliseconds) ||
    !Number.isFinite(new Date(milliseconds).getTime())) throw malformedResponse();
  return milliseconds;
}

function normalizeHours(hours, extended) {
  // Missing is unknown; an explicitly empty array is preserved as empty.
  if (hours === undefined || hours === null) return null;
  if (!Array.isArray(hours)) throw malformedResponse();
  return hours.map((interval) => {
    if (!isObject(interval)) throw malformedResponse();
    const openingTime = epochMilliseconds(interval.opening);
    const closingTime = epochMilliseconds(interval.closing);
    if (closingTime <= openingTime) throw malformedResponse();
    const result = { openingTime, closingTime };
    if (extended) {
      const cancel = interval.cancel_daily_orders;
      if (cancel !== undefined && cancel !== null && typeof cancel !== 'boolean') throw malformedResponse();
      result.cancelDailyOrders = cancel ?? null;
    }
    return result;
  }).sort((a, b) => a.openingTime - b.openingTime);
}

export function normalizeTradingSchedule(response, query) {
  if (!isObject(response) || Object.hasOwn(response, 'error') || !isObject(response.schedules)) {
    throw malformedResponse();
  }
  const days = Object.entries(response.schedules).map(([date, schedule]) => {
    // The documented example has one object per day; its field description
    // allows an array. Preserve groups rather than merging across session breaks.
    const sessions = Array.isArray(schedule) ? schedule : [schedule];
    return {
      date: dateLabel(date),
      sessions: sessions.map((session) => {
        if (!isObject(session) || Object.hasOwn(session, 'error')) throw malformedResponse();
        return {
          regularHours: normalizeHours(session.liquid_hours, false),
          extendedHours: normalizeHours(session.extended_hours, true)
        };
      })
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return {
    conid: query.conid,
    // This is the requested venue, not a claim that IBKR echoed/resolved it.
    requestedExchange: query.exchange,
    exchangeTimeZone: textOrNull(response.exchange_time_zone),
    timestampUnit: 'milliseconds',
    days
  };
}

export function createTradingScheduleService({ getBrokerageRequest }) {
  return async function getTradingSchedule(query, sessionToken) {
    const params = new URLSearchParams({ conid: query.conid });
    if (query.exchange !== null) params.set('exchange', query.exchange);
    // Omit exchange to let IBKR choose its documented primary-exchange default.
    const response = await getBrokerageRequest(`/contract/trading-schedule?${params}`, sessionToken);
    return normalizeTradingSchedule(response, query);
  };
}
