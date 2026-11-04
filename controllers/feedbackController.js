const Feedback = require('../models/Feedback');
const Session = require('../models/Session');

async function createFeedback(req, res) {
  try {
    const { sessionId, rating, comment } = req.body;
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        data: null,
        message: 'Session not found.',
      });
    }

    const feedback = await Feedback.create({
      sessionId: session._id,
      tableId: session.tableId,
      rating,
      comment,
    });
    const io = req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
    if (io) {
      io.to('admin').emit('new_feedback', {
        _id: feedback._id,
        rating: feedback.rating,
        comment: feedback.comment,
        createdAt: feedback.createdAt,
      });
    }
    return res.status(201).json({ success: true, data: feedback, message: 'ส่งความคิดเห็นสำเร็จ' });
  } catch (error) {
    console.error('Create feedback failed:', error);
    const status = error.name === 'CastError' || error.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? error.message : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

async function getAllFeedbacks(req, res) {
  try {
    if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        data: null,
        message: 'You are not allowed to perform this action.',
      });
    }
    const feedbacks = await Feedback.find()
      .populate({
        path: 'sessionId',
        populate: { path: 'queueId', select: 'queueNumber customerCount' },
      })
      .populate('tableId', 'tableNumber zone capacity')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: feedbacks, message: 'ดึงรีวิวสำเร็จ' });
  } catch (error) {
    console.error('Get feedbacks failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function getFeedbackBySession(req, res) {
  try {
    const sessionId = req.params.sessionId || req.query.sessionId;
    const feedbacks = await Feedback.find({ sessionId }).sort({ createdAt: -1 });
    return res
      .status(200)
      .json({ success: true, data: feedbacks, message: 'ดึงรีวิวของเซสชันสำเร็จ' });
  } catch (error) {
    console.error('Get feedback by session failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'รูปแบบ ID ไม่ถูกต้อง' : 'เกิดข้อผิดพลาดในระบบ',
    });
  }
}

module.exports = { createFeedback, getAllFeedbacks, getFeedbackBySession };
