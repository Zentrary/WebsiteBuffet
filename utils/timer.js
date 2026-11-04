const { SESSION_DURATION } = require('../config/constants');

function calculateEndTime(startTime, durationMinutes = SESSION_DURATION) {
  return new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000);
}

function getRemainingTime(endTime) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(endTime).getTime() - Date.now()) / 1000)
  );
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  return {
    hours,
    minutes,
    seconds,
    isExpired: remainingSeconds === 0,
  };
}

function isExpired(endTime) {
  return new Date() >= new Date(endTime);
}

module.exports = { calculateEndTime, getRemainingTime, isExpired };
