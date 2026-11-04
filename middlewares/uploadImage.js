const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const supabaseStorage = require('../services/supabaseStorage');

const isServerless = Boolean(process.env.VERCEL);
const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
const extensions = supabaseStorage.EXTENSIONS;

if (!isServerless) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

function useMemoryStorage() {
  return isServerless || supabaseStorage.isConfigured();
}

const storage = useMemoryStorage()
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: uploadDirectory,
      filename(_req, file, callback) {
        callback(null, `${crypto.randomUUID()}${extensions[file.mimetype] || ''}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: supabaseStorage.MAX_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    callback(null, Boolean(extensions[file.mimetype]));
  },
});

upload.requirePersistentStorage = function requirePersistentStorage(_req, _res, next) {
  return next();
};

upload.persistUploadedFile = async function persistUploadedFile(file, folder = 'misc') {
  if (!file) {
    const error = new Error('รองรับเฉพาะ JPG, PNG, WEBP หรือ GIF ขนาดไม่เกิน 5 MB');
    error.code = 'INVALID_IMAGE';
    error.status = 400;
    throw error;
  }
  if (supabaseStorage.isConfigured()) {
    const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
    const stored = await supabaseStorage.uploadBuffer({
      buffer,
      contentType: file.mimetype,
      folder,
    });
    return stored.imageUrl;
  }
  if (!isServerless && file.filename) {
    return `/uploads/${file.filename}`;
  }
  const error = new Error(
    'ยังไม่สามารถอัปโหลดไฟล์ได้ กรุณาตั้งค่า Supabase Storage หรือใช้ URL รูปภาพ'
  );
  error.code = 'UPLOAD_STORAGE_UNAVAILABLE';
  error.status = 501;
  throw error;
};

module.exports = upload;
