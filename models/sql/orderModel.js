const { querySQL, connectSQL } = require('../../config/db.sql');

const orderModel = {
  async create({ sessionId, mongoOrderId = null, tableId, items = [], totalPrice = 0 }) {
    const pool = await connectSQL();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders (session_id, mongo_order_id, table_id, total_price, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id, session_id, mongo_order_id, table_id, total_price, status, created_at`,
        [sessionId, mongoOrderId, tableId, totalPrice]
      );
      const order = orderResult.rows[0];

      const itemRows = [];
      for (const item of items) {
        const itemResult = await client.query(
          `INSERT INTO order_items (order_id, menu_id, name, price, quantity, note, item_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')
           RETURNING id, order_id, menu_id, name, price, quantity, note, item_status`,
          [
            order.id,
            item.menuId ? String(item.menuId) : null,
            item.name,
            Number(item.price || 0),
            Number(item.quantity || 1),
            item.note || null,
          ]
        );
        itemRows.push(itemResult.rows[0]);
      }

      await client.query('COMMIT');
      return { ...order, items: itemRows };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async findById(id) {
    const orderResult = await querySQL(
      `SELECT id, session_id, mongo_order_id, table_id, total_price, status, accepted_at, cooking_at, ready_at, served_at, created_at
       FROM orders WHERE id = $1`,
      [id]
    );
    if (orderResult.rows.length === 0) return null;
    const order = orderResult.rows[0];

    const itemsResult = await querySQL(
      `SELECT id, menu_id, name, price, quantity, note, item_status
       FROM order_items WHERE order_id = $1 ORDER BY created_at`,
      [id]
    );
    order.items = itemsResult.rows;
    return order;
  },

  async findBySessionId(sessionId, excludeCancelled = true) {
    const ordersResult = await querySQL(
      `SELECT id, session_id, mongo_order_id, table_id, total_price, status, accepted_at, cooking_at, ready_at, served_at, created_at
       FROM orders WHERE session_id = $1 ${excludeCancelled ? "AND status <> 'cancelled'" : ''}
       ORDER BY created_at`,
      [sessionId]
    );
    const orders = ordersResult.rows;

    for (const order of orders) {
      const itemsResult = await querySQL(
        `SELECT id, menu_id, name, price, quantity, note, item_status
         FROM order_items WHERE order_id = $1 ORDER BY created_at`,
        [order.id]
      );
      order.items = itemsResult.rows;
    }
    return orders;
  },

  async updateStatus(id, status) {
    const result = await querySQL(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    return result.rows[0] || null;
  },
};

module.exports = orderModel;
