export function mapOrder(row) {
    if (!row) return row;

    return {
        ...row,
        // Orders store amounts in paisa; their fixed denomination is INR.
        currency: 'INR',
        customerId: row.customerId ?? row.customer_id,
        driverId: row.driverId ?? row.driver_id,
        cargoType: row.cargoType ?? row.goods_type,
        weight: row.weight ?? row.weight_tonnes,
        amount: row.amount ?? row.total_amount,
        pickup: {
            lat: row.pickup_lat,
            lng: row.pickup_lng,
            address: row.pickup_address,
        },
        dropoff: {
            lat: row.drop_lat,
            lng: row.drop_lng,
            address: row.drop_address,
        },
        createdAt: row.createdAt ?? row.created_at,
        updatedAt: row.updatedAt ?? row.updated_at,
    };
}
