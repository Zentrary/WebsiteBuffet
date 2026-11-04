const { parseTime, getShopStatus } = require('./shopStatus');

const DEFAULT_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_OPEN_TIME = '10:30';
const DEFAULT_CLOSE_TIME = '03:00';
const DAY_MS = 24 * 60 * 60 * 1000;

function timezoneOf(settings) {
  return (settings && settings.timezone) || DEFAULT_TIMEZONE;
}

function openMinutesOf(settings) {
  const parsed = parseTime(settings && settings.openTime);
  return parsed === null ? parseTime(DEFAULT_OPEN_TIME) : parsed;
}

function closeMinutesOf(settings) {
  const parsed = parseTime(settings && settings.closeTime);
  return parsed === null ? parseTime(DEFAULT_CLOSE_TIME) : parsed;
}

function lastQueueMinutesOf(settings) {
  const parsed = parseTime(settings && settings.lastQueueTime);
  return parsed === null ? closeMinutesOf(settings) : parsed;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return get('hour') * 60 + get('minute');
}

function offsetMs(date, timezone) {
  const { year, month, day } = zonedParts(date, timezone);
  const minutes = zonedMinutes(date, timezone);
  return Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60) - date.getTime();
}

function zonedDateTimeToUtc(parts, minutes, timezone) {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60
  );

  let timestamp = guess - offsetMs(new Date(guess), timezone);
  timestamp = guess - offsetMs(new Date(timestamp), timezone);
  return new Date(timestamp);
}

function shiftDate(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatDateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function getBusinessDateKey(settings, now = new Date()) {
  const shifted = new Date(now.getTime() - openMinutesOf(settings) * 60 * 1000);
  return formatDateKey(zonedParts(shifted, timezoneOf(settings)));
}

function getBusinessDayStart(settings, dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  return zonedDateTimeToUtc(parts, openMinutesOf(settings), timezoneOf(settings));
}

function getBusinessDayRange(settings, now = new Date(), days = 1) {
  const count = Math.max(1, Number(days) || 1);
  const currentKey = getBusinessDateKey(settings, now);
  const currentParts = parseDateKey(currentKey);
  const startKey = formatDateKey(shiftDate(currentParts, -(count - 1)));
  const endKey = formatDateKey(shiftDate(currentParts, 1));
  return {
    businessDate: currentKey,
    startKey,
    start: getBusinessDayStart(settings, startKey),
    end: getBusinessDayStart(settings, endKey),
    days: count,
  };
}

function getBusinessDayRangeForKeys(settings, fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return null;
  const dateKeys = [];
  for (let cursor = from, guard = 0; guard < 400; guard += 1) {
    dateKeys.push(formatDateKey(cursor));
    if (formatDateKey(cursor) === formatDateKey(to)) break;
    cursor = shiftDate(cursor, 1);
  }
  return {
    businessDate: formatDateKey(to),
    startKey: formatDateKey(from),
    start: getBusinessDayStart(settings, formatDateKey(from)),
    end: getBusinessDayStart(settings, formatDateKey(shiftDate(to, 1))),
    days: dateKeys.length,
    dateKeys,
  };
}

function getBusinessDateKeys(settings, now = new Date(), days = 1) {
  const count = Math.max(1, Number(days) || 1);
  const currentParts = parseDateKey(getBusinessDateKey(settings, now));
  return Array.from({ length: count }, (_, index) =>
    formatDateKey(shiftDate(currentParts, -(count - 1 - index)))
  );
}

function getQueueCutoff(settings, now = new Date()) {
  const timezone = timezoneOf(settings);
  const open = openMinutesOf(settings);
  const cutoff = lastQueueMinutesOf(settings);
  const businessParts = parseDateKey(getBusinessDateKey(settings, now));
  const dayOffset = cutoff >= open ? 0 : 1;
  return zonedDateTimeToUtc(shiftDate(businessParts, dayOffset), cutoff, timezone);
}

function getQueueAcceptance(settings, now = new Date()) {
  const businessDate = settings ? getBusinessDateKey(settings, now) : null;
  const cutoffAt = settings ? getQueueCutoff(settings, now) : null;
  const status = settings ? getShopStatus(settings, now) : null;
  const base = {
    businessDate,
    cutoffAt,
    closesAt: (status && status.closesAt) || null,
  };
  if (settings && settings.isTestMode) return { ...base, accepting: false, reason: 'test_mode' };
  if (!status || !status.isOpen) return { ...base, accepting: false, reason: 'closed' };
  if (cutoffAt && now.getTime() >= cutoffAt.getTime())
    return { ...base, accepting: false, reason: 'cutoff' };
  return { ...base, accepting: true, reason: 'open' };
}

module.exports = {
  DAY_MS,
  DEFAULT_CLOSE_TIME,
  DEFAULT_OPEN_TIME,
  DEFAULT_TIMEZONE,
  closeMinutesOf,
  formatDateKey,
  getBusinessDateKey,
  getBusinessDateKeys,
  getBusinessDayRange,
  getBusinessDayRangeForKeys,
  getBusinessDayStart,
  getQueueAcceptance,
  getQueueCutoff,
  lastQueueMinutesOf,
  openMinutesOf,
  parseDateKey,
  shiftDate,
  zonedDateTimeToUtc,
  timezoneOf,
};
