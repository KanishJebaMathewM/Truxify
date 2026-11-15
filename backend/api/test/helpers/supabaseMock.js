// Correct property names
this._table
this._store
this._programmed
this._calls
this._mode
this._payload
this._select = '*';
this._filters = [];
this._order = null;
this._orders = [];
this._limit = null;

// Correct regular expression
const valRegex = new RegExp(f.val.replace(/%/g, '.*'), 'i');

// Correct string interpolation
const id = `mock-${this._table}-${this._store[this._table].length}`;

// Correct object property access
row.device_id
row.user_id
row.fcm_token
row.is_active
row.deactivated_at

// Correct signed URL
const signedUrl =
  `https://mock-storage.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock-token`;
