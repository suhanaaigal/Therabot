require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const CallSession = require('../models/CallSession');
const { parseKolkataDateTime } = require('../services/appointmentTime');

const migrateCollection = async model => {
  const cursor = model.find({
    scheduledAt: { $exists: false },
    scheduledDate: { $type: 'string' },
    scheduledTime: { $type: 'string' }
  }).cursor();
  let migrated = 0;
  for await (const record of cursor) {
    const scheduledAt = parseKolkataDateTime(record.scheduledDate, record.scheduledTime);
    if (!scheduledAt) {
      console.warn(`Skipping invalid legacy ${model.modelName} record ${record._id}.`);
      continue;
    }
    record.scheduledAt = scheduledAt;
    await record.save();
    migrated += 1;
  }
  return migrated;
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be configured before migrating appointment dates.');
  await mongoose.connect(process.env.MONGO_URI);
  const appointments = await migrateCollection(Appointment);
  const sessions = await migrateCollection(CallSession);
  console.log(`Migrated ${appointments} appointments and ${sessions} call sessions to scheduledAt (UTC).`);
};

main()
  .catch(error => {
    console.error('Appointment date migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
