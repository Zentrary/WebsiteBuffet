const { querySQL } = require('../../config/db.sql');

const SELECT_COLUMNS = `
  setting_key, setting_value, restaurant_name, welcome_message, phone, address,
  open_time, close_time, last_queue_time, timezone, is_test_mode,
  dining_duration_minutes, logo_url, hero_image_url,
  vat_percent, service_charge_percent, vat_mode, service_charge_mode,
  buffet_signature_price, buffet_premium_price, buffet_deluxe_price, refill_drink_price,
  prompt_pay_id, payment_qr_image_url, created_at, updated_at
`;

const shopSettingsModel = {
  async getSettings() {
    const result = await querySQL(
      `SELECT ${SELECT_COLUMNS}
       FROM shop_settings
       WHERE setting_key = 'shop-settings'
       LIMIT 1`
    );
    return result.rows[0] || null;
  },

  async updateSettings(settings = {}) {
    const result = await querySQL(
      `INSERT INTO shop_settings (
         setting_key,
         restaurant_name, welcome_message, phone, address,
         open_time, close_time, last_queue_time, timezone, is_test_mode,
         dining_duration_minutes, logo_url, hero_image_url,
         vat_percent, service_charge_percent, vat_mode, service_charge_mode,
         buffet_signature_price, buffet_premium_price, buffet_deluxe_price, refill_drink_price,
         prompt_pay_id, payment_qr_image_url, updated_at
       )
       VALUES (
         'shop-settings',
         COALESCE($1, 'Smart Queue Restaurant'),
         COALESCE($2, ''),
         COALESCE($3, ''),
         COALESCE($4, ''),
         COALESCE($5, '10:30'),
         COALESCE($6, '03:00'),
         COALESCE($7, '02:00'),
         COALESCE($8, 'Asia/Bangkok'),
         COALESCE($9, false),
         COALESCE($10, 90),
         COALESCE($11, '/assets/images/logo.png'),
         COALESCE($12, ''),
         COALESCE($13, 7.00),
         COALESCE($14, 10.00),
         COALESCE($15, 'included'),
         COALESCE($16, 'included'),
         COALESCE($17, 499.00),
         COALESCE($18, 599.00),
         COALESCE($19, 699.00),
         COALESCE($20, 49.00),
         $21,
         $22,
         NOW()
       )
       ON CONFLICT (setting_key) DO UPDATE SET
         restaurant_name = COALESCE(EXCLUDED.restaurant_name, shop_settings.restaurant_name),
         welcome_message = COALESCE($2, shop_settings.welcome_message),
         phone = COALESCE($3, shop_settings.phone),
         address = COALESCE($4, shop_settings.address),
         open_time = COALESCE($5, shop_settings.open_time),
         close_time = COALESCE($6, shop_settings.close_time),
         last_queue_time = COALESCE($7, shop_settings.last_queue_time),
         timezone = COALESCE($8, shop_settings.timezone),
         is_test_mode = COALESCE($9, shop_settings.is_test_mode),
         dining_duration_minutes = COALESCE($10, shop_settings.dining_duration_minutes),
         logo_url = COALESCE($11, shop_settings.logo_url),
         hero_image_url = COALESCE($12, shop_settings.hero_image_url),
         vat_percent = COALESCE($13, shop_settings.vat_percent),
         service_charge_percent = COALESCE($14, shop_settings.service_charge_percent),
         vat_mode = COALESCE($15, shop_settings.vat_mode),
         service_charge_mode = COALESCE($16, shop_settings.service_charge_mode),
         buffet_signature_price = COALESCE($17, shop_settings.buffet_signature_price),
         buffet_premium_price = COALESCE($18, shop_settings.buffet_premium_price),
         buffet_deluxe_price = COALESCE($19, shop_settings.buffet_deluxe_price),
         refill_drink_price = COALESCE($20, shop_settings.refill_drink_price),
         prompt_pay_id = COALESCE($21, shop_settings.prompt_pay_id),
         payment_qr_image_url = COALESCE($22, shop_settings.payment_qr_image_url),
         updated_at = NOW()
       RETURNING ${SELECT_COLUMNS}`,
      [
        settings.restaurantName ?? null,
        settings.welcomeMessage ?? null,
        settings.phone ?? null,
        settings.address ?? null,
        settings.openTime ?? null,
        settings.closeTime ?? null,
        settings.lastQueueTime ?? null,
        settings.timezone ?? null,
        settings.isTestMode !== undefined ? Boolean(settings.isTestMode) : null,
        settings.diningDurationMinutes !== undefined
          ? Number(settings.diningDurationMinutes) || 90
          : null,
        settings.logoUrl ?? null,
        settings.heroImageUrl ?? null,
        settings.vatPercent ?? null,
        settings.serviceChargePercent ?? null,
        settings.vatMode ?? null,
        settings.serviceChargeMode ?? null,
        settings.buffetSignaturePrice ?? null,
        settings.buffetPremiumPrice ?? null,
        settings.buffetDeluxePrice ?? null,
        settings.refillDrinkPrice ?? null,
        settings.promptPayId ?? null,
        settings.paymentQrImageUrl ?? null,
      ]
    );
    return result.rows[0];
  },
};

module.exports = shopSettingsModel;
