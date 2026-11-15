export const scheduledAtFromKolkataInput = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const appointmentTimestamp = appointment => {
  if (appointment?.scheduledAt) {
    const timestamp = new Date(appointment.scheduledAt).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const scheduledAt = scheduledAtFromKolkataInput(appointment?.scheduledDate, appointment?.scheduledTime);
  return scheduledAt ? new Date(scheduledAt).getTime() : NaN;
};
