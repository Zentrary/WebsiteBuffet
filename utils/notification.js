function formatKitchenItem(item) {
  return {
    name: item.name,
    quantity: item.quantity,
    note: item.note || '',
    itemStatus: item.itemStatus,
  };
}

function formatOrderForKitchen(order) {
  const table = order.tableId && typeof order.tableId === 'object' ? order.tableId : null;

  return {
    orderId: order._id ? String(order._id) : null,
    tableNumber: table && table.tableNumber ? table.tableNumber : null,
    items: (order.items || []).map(formatKitchenItem),
    status: order.status,
    createdAt: order.createdAt,
    totalPrice: order.totalPrice,
  };
}

function formatCurrency(amount) {
  return `฿${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

module.exports = { formatOrderForKitchen, formatCurrency };
