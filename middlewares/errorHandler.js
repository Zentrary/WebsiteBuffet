function errorHandler(err, req, res, next) {
  console.error('Application error:', err);

  if (res.headersSent) {
    return next(err);
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'รูปแบบ ID ไม่ถูกต้อง' });
  }

  if (err.code === 11000) {
    return res.status(400).json({ message: 'ข้อมูลซ้ำ' });
  }

  return res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
}

function notFound(req, res, next) {
  return res.status(404).json({ message: 'ไม่พบเส้นทางนี้' });
}

module.exports = { errorHandler, notFound };
