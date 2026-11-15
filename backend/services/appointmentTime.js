const KOLKATA_OFFSET = '+05:30';
const CONFLICT_WINDOW_MS = 30 * 60 * 1000;

const parseKolkataDateTime = (scheduledDate, scheduledTime) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scheduledDate || '')) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(scheduledTime || ''))) return null;
  const [year, month, day] = String(scheduledDate).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const date = new Date(`${scheduledDate}T${scheduledTime}:00${KOLKATA_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toKolkataFields = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    scheduledDate: `${fields.year}-${fields.month}-${fields.day}`,
    scheduledTime: `${fields.hour}:${fields.minute}`
  };
};

const getAppointmentInstant = appointment => {
  if (appointment?.scheduledAt) {
    const date = new Date(appointment.scheduledAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return parseKolkataDateTime(appointment?.scheduledDate, appointment?.scheduledTime);
};

const hasConflict = (first, second) => {
  const firstDate = first instanceof Date ? first : getAppointmentInstant(first);
  const secondDate = second instanceof Date ? second : getAppointmentInstant(second);
  return Boolean(firstDate && secondDate && Math.abs(firstDate.getTime() - secondDate.getTime()) < CONFLICT_WINDOW_MS);
};

module.exports = {
  CONFLICT_WINDOW_MS,
  parseKolkataDateTime,
  toKolkataFields,
  getAppointmentInstant,
  hasConflict
};
