const roundMoney = (val) => Math.round(((Number(val) || 0) + Number.EPSILON) * 100) / 100;

const DEFAULT_BUFFET_PACKAGES = Object.freeze([
  { code: 'SIGNATURE', name: 'Signature Buffet', pricePerPerson: 499, rank: 1 },
  { code: 'PREMIUM', name: 'Premium Buffet', pricePerPerson: 599, rank: 2 },
  { code: 'DELUXE', name: 'Deluxe Buffet', pricePerPerson: 699, rank: 3 },
]);

const DEFAULT_REFILL_DRINK_PRICE = 49;

const TIER_RANKS = Object.freeze({
  SIGNATURE: 1,
  PREMIUM: 2,
  DELUXE: 3,
  ALACARTE_ONLY: 99,
});

const ALLOWED_MENU_BUFFET_TIERS = Object.freeze([
  'auto',
  'SIGNATURE',
  'PREMIUM',
  'DELUXE',
  'ALACARTE_ONLY',
]);

function getConfiguredBuffetPackages(settings = null) {
  const s = settings || {};
  const sigPrice =
    Number.isFinite(Number(s.buffetSignaturePrice)) && Number(s.buffetSignaturePrice) >= 0
      ? roundMoney(s.buffetSignaturePrice)
      : 499;
  const premPrice =
    Number.isFinite(Number(s.buffetPremiumPrice)) && Number(s.buffetPremiumPrice) >= 0
      ? roundMoney(s.buffetPremiumPrice)
      : 599;
  const delPrice =
    Number.isFinite(Number(s.buffetDeluxePrice)) && Number(s.buffetDeluxePrice) >= 0
      ? roundMoney(s.buffetDeluxePrice)
      : 699;

  return [
    { code: 'SIGNATURE', name: 'Signature Buffet', pricePerPerson: sigPrice, rank: 1 },
    { code: 'PREMIUM', name: 'Premium Buffet', pricePerPerson: premPrice, rank: 2 },
    { code: 'DELUXE', name: 'Deluxe Buffet', pricePerPerson: delPrice, rank: 3 },
  ];
}

function getConfiguredRefillPrice(settings = null) {
  const s = settings || {};
  if (Number.isFinite(Number(s.refillDrinkPrice)) && Number(s.refillDrinkPrice) >= 0) {
    return roundMoney(s.refillDrinkPrice);
  }
  return DEFAULT_REFILL_DRINK_PRICE;
}

function normalizeDiningSelection(raw = {}, settings = null) {
  const styleRaw = String(raw.diningStyle || '')
    .trim()
    .toLowerCase();
  const diningStyle = styleRaw === 'buffet' ? 'buffet' : 'alacarte';
  const hasRefillDrink = Boolean(
    raw.hasRefillDrink === true || raw.hasRefillDrink === 'true' || raw.hasRefillDrink === '1'
  );
  const packages = getConfiguredBuffetPackages(settings);
  const refillPricePerPerson = getConfiguredRefillPrice(settings);

  if (diningStyle !== 'buffet') {
    return {
      diningStyle: 'alacarte',
      buffetPackageCode: '',
      buffetPackageName: '',
      buffetPricePerPerson: 0,
      hasRefillDrink,
      refillPricePerPerson: hasRefillDrink ? refillPricePerPerson : 0,
    };
  }

  const requestedCode = String(raw.buffetPackageCode || 'SIGNATURE')
    .trim()
    .toUpperCase();
  const matched = packages.find((pkg) => pkg.code === requestedCode) || packages[0];

  return {
    diningStyle: 'buffet',
    buffetPackageCode: matched.code,
    buffetPackageName: matched.name,
    buffetPricePerPerson: matched.pricePerPerson,
    hasRefillDrink,
    refillPricePerPerson: hasRefillDrink ? refillPricePerPerson : 0,
  };
}

function resolveMenuBuffetTier(menu) {
  const explicit = menu && typeof menu.buffetTier === 'string' ? menu.buffetTier.trim() : 'auto';
  if (explicit && explicit !== 'auto' && TIER_RANKS[explicit]) {
    return explicit;
  }
  const category = String((menu && menu.category) || '')
    .trim()
    .toLowerCase();
  if (category === 'set') {
    return 'ALACARTE_ONLY';
  }
  const price = Number(menu && menu.price) || 0;
  if (price > 230) return 'DELUXE';
  if (price > 170) return 'PREMIUM';
  return 'SIGNATURE';
}

function effectiveMenuPriceForSession(menu, session = null) {
  const basePrice = roundMoney(Number(menu && menu.price) || 0);
  const requiredTier = resolveMenuBuffetTier(menu);

  if (!session || session.diningStyle !== 'buffet') {
    return {
      unitPrice: basePrice,
      basePrice,
      isBuffetIncluded: false,
      requiredTier,
    };
  }

  const pkgCode = String(session.buffetPackageCode || 'SIGNATURE').toUpperCase();
  const sessionRank = TIER_RANKS[pkgCode] || 1;
  const itemRank = TIER_RANKS[requiredTier] || 99;

  if (sessionRank >= itemRank) {
    return {
      unitPrice: 0,
      basePrice,
      isBuffetIncluded: true,
      requiredTier,
    };
  }

  return {
    unitPrice: basePrice,
    basePrice,
    isBuffetIncluded: false,
    requiredTier,
  };
}

function computeSessionBaseCharges(session = null) {
  if (!session) {
    return {
      diningStyle: 'alacarte',
      customerCount: 1,
      buffetPackageCode: '',
      buffetPackageName: '',
      buffetPricePerPerson: 0,
      buffetTotal: 0,
      hasRefillDrink: false,
      refillPricePerPerson: 0,
      refillTotal: 0,
      baseTotal: 0,
      lines: [],
    };
  }

  const customerCount = Math.max(1, Number.parseInt(String(session.customerCount || 1), 10) || 1);
  const diningStyle = session.diningStyle === 'buffet' ? 'buffet' : 'alacarte';
  const buffetPricePerPerson =
    diningStyle === 'buffet' ? roundMoney(Number(session.buffetPricePerPerson) || 0) : 0;
  const buffetTotal =
    diningStyle === 'buffet' ? roundMoney(customerCount * buffetPricePerPerson) : 0;

  const hasRefillDrink = Boolean(session.hasRefillDrink);
  const refillPricePerPerson = hasRefillDrink
    ? roundMoney(Number(session.refillPricePerPerson) || DEFAULT_REFILL_DRINK_PRICE)
    : 0;
  const refillTotal = hasRefillDrink ? roundMoney(customerCount * refillPricePerPerson) : 0;

  const lines = [];
  if (diningStyle === 'buffet' && buffetPricePerPerson > 0) {
    lines.push({
      type: 'buffet_package',
      code: session.buffetPackageCode || 'SIGNATURE',
      label: session.buffetPackageName || 'Buffet',
      unitPrice: buffetPricePerPerson,
      quantity: customerCount,
      total: buffetTotal,
    });
  }
  if (hasRefillDrink && refillPricePerPerson > 0) {
    lines.push({
      type: 'refill_drink',
      code: 'REFILL',
      label: 'น้ำรีฟิล (Refill Drink)',
      unitPrice: refillPricePerPerson,
      quantity: customerCount,
      total: refillTotal,
    });
  }

  return {
    diningStyle,
    customerCount,
    buffetPackageCode: diningStyle === 'buffet' ? session.buffetPackageCode || 'SIGNATURE' : '',
    buffetPackageName:
      diningStyle === 'buffet' ? session.buffetPackageName || 'Signature Buffet' : '',
    buffetPricePerPerson,
    buffetTotal,
    hasRefillDrink,
    refillPricePerPerson,
    refillTotal,
    baseTotal: roundMoney(buffetTotal + refillTotal),
    lines,
  };
}

module.exports = {
  DEFAULT_BUFFET_PACKAGES,
  DEFAULT_REFILL_DRINK_PRICE,
  ALLOWED_MENU_BUFFET_TIERS,
  TIER_RANKS,
  getConfiguredBuffetPackages,
  getConfiguredRefillPrice,
  normalizeDiningSelection,
  resolveMenuBuffetTier,
  effectiveMenuPriceForSession,
  computeSessionBaseCharges,
};
