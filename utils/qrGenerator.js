const QRCode = require('qrcode');

async function generateQRCode(value) {
  try {
    return await QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 2 });
  } catch (error) {
    console.error('QR Code generation failed:', error);
    throw error;
  }
}

module.exports = { generateQRCode };
