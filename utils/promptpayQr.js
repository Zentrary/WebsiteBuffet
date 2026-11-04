const QRCode = require('qrcode');

function tlv(id, value) {
  const str = String(value);
  const len = String(str.length).padStart(2, '0');
  return `${id}${len}${str}`;
}

function crc16Ccitt(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizePromptPayTarget(rawTarget) {
  const digits = String(rawTarget || '').replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.length === 10 && digits.startsWith('0')) {
    return {
      subTag: '01',
      formatted: `0066${digits.slice(1)}`,
      rawDigits: digits,
      type: 'phone',
    };
  }

  if (digits.length === 13) {
    return {
      subTag: '02',
      formatted: digits,
      rawDigits: digits,
      type: 'tax_id',
    };
  }

  if (digits.length === 15) {
    return {
      subTag: '03',
      formatted: digits,
      rawDigits: digits,
      type: 'ewallet',
    };
  }
  return null;
}

function buildPromptPayPayload(rawTarget, amount = null) {
  const target = normalizePromptPayTarget(rawTarget);
  if (!target) return null;

  const numAmount = amount !== null && amount !== undefined ? Number(amount) : null;
  const hasAmount = Number.isFinite(numAmount) && numAmount > 0;

  const merchantInfo = tlv('00', 'A000000677010111') + tlv(target.subTag, target.formatted);

  const fields = [
    tlv('00', '01'),
    tlv('01', hasAmount ? '12' : '11'),
    tlv('29', merchantInfo),
    tlv('58', 'TH'),
    tlv('53', '764'),
  ];

  if (hasAmount) {
    fields.push(tlv('54', numAmount.toFixed(2)));
  }

  const withoutCrc = `${fields.join('')}6304`;
  return `${withoutCrc}${crc16Ccitt(withoutCrc)}`;
}

async function generatePromptPayQrDataUrl(rawTarget, amount = null) {
  const payload = buildPromptPayPayload(rawTarget, amount);
  if (!payload) return null;
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return { payload, dataUrl };
}

module.exports = {
  crc16Ccitt,
  normalizePromptPayTarget,
  buildPromptPayPayload,
  generatePromptPayQrDataUrl,
};
