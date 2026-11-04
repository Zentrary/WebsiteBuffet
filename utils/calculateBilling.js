const { SERVICE_CHARGE: SERVICE_CHARGE_PERCENT, VAT: VAT_PERCENT } = require('../config/constants');

const roundCurrency = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;

function calculateTotal(subtotal, discount = 0, settings = {}) {
  if (!Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(discount) || discount < 0) {
    throw new RangeError('Subtotal and discount must be finite, non-negative amounts.');
  }

  const normalizedSubtotal = roundCurrency(subtotal);
  const normalizedDiscount = roundCurrency(discount);

  const vatPercent = Number.isFinite(Number(settings.vatPercent))
    ? Number(settings.vatPercent)
    : VAT_PERCENT;
  const servicePercent = Number.isFinite(Number(settings.serviceChargePercent))
    ? Number(settings.serviceChargePercent)
    : SERVICE_CHARGE_PERCENT;
  const vatMode = settings.vatMode === 'excluded' ? 'excluded' : 'included';
  const serviceMode = settings.serviceChargeMode === 'excluded' ? 'excluded' : 'included';

  const s = servicePercent / 100;
  const v = vatPercent / 100;

  let serviceCharge = 0;
  let vat = 0;
  let grandTotal = 0;

  if (serviceMode === 'included' && vatMode === 'included') {
    const denom = (1 + s) * (1 + v);
    const base = denom > 0 ? normalizedSubtotal / denom : normalizedSubtotal;
    serviceCharge = roundCurrency(base * s);
    vat = roundCurrency(base * (1 + s) * v);
    grandTotal = roundCurrency(normalizedSubtotal - normalizedDiscount);
  } else if (serviceMode === 'excluded' && vatMode === 'excluded') {
    serviceCharge = roundCurrency(normalizedSubtotal * s);
    vat = roundCurrency((normalizedSubtotal + serviceCharge) * v);
    if (normalizedDiscount > normalizedSubtotal + serviceCharge + vat) {
      throw new RangeError('Discount cannot exceed the bill total.');
    }
    grandTotal = roundCurrency(normalizedSubtotal + serviceCharge + vat - normalizedDiscount);
  } else if (serviceMode === 'excluded' && vatMode === 'included') {
    serviceCharge = roundCurrency(normalizedSubtotal * s);
    const withService = roundCurrency(normalizedSubtotal + serviceCharge);
    const baseForVat = v > 0 ? withService / (1 + v) : withService;
    vat = roundCurrency(withService - baseForVat);
    grandTotal = roundCurrency(withService - normalizedDiscount);
  } else {
    const base = 1 + s > 0 ? normalizedSubtotal / (1 + s) : normalizedSubtotal;
    serviceCharge = roundCurrency(normalizedSubtotal - base);
    vat = roundCurrency(normalizedSubtotal * v);
    grandTotal = roundCurrency(normalizedSubtotal + vat - normalizedDiscount);
  }

  return {
    subtotal: normalizedSubtotal,
    serviceCharge,
    vat,
    discount: normalizedDiscount,
    grandTotal,
    vatMode,
    serviceChargeMode: serviceMode,
    vatPercent,
    serviceChargePercent: servicePercent,
  };
}

module.exports = { calculateTotal };
