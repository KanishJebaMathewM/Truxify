async insertEvent(row) {
  return supabaseClient
    .from('event_store')
    .upsert([row], {
      onConflict: 'aggregate_id,version',
      ignoreDuplicates: true,
    })
    .select(); // Ensures inserted/affected rows are returned to the core logic
}
