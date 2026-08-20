package sandbox

import "context"

// Table is one table's shape. No rows: describe_schema tells an agent what it
// may query, and the rows are db(sql)'s business.
type Table struct {
	Name    string   `json:"name"`
	Key     string   `json:"high_water_column,omitempty"`
	Columns []Column `json:"columns"`
}

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable,omitempty"`
	Key      string `json:"key,omitempty"`
	Default  string `json:"default,omitempty"`
	Extra    string `json:"extra,omitempty"`
}

// Schema reads the shape of one table, or of every table when name is empty.
func (s *Sandbox) Schema(ctx context.Context, name string) ([]Table, error) {
	tables, err := s.baseTables(ctx)
	if err != nil {
		return nil, err
	}
	keys, err := s.keys(ctx)
	if err != nil {
		return nil, err
	}

	cols, err := s.columns(ctx, name)
	if err != nil {
		return nil, err
	}

	out := make([]Table, 0, len(tables))
	for _, t := range tables {
		if name != "" && t != name {
			continue
		}
		out = append(out, Table{Name: t, Key: keys[t], Columns: cols[t]})
	}
	return out, nil
}

func (s *Sandbox) columns(ctx context.Context, only string) (map[string][]Column, error) {
	args := []any{s.creds.Database}
	q := `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY,
	        COALESCE(COLUMN_DEFAULT, ''), EXTRA
	      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`
	if only != "" {
		q += ` AND TABLE_NAME = ?`
		args = append(args, only)
	}
	q += ` ORDER BY TABLE_NAME, ORDINAL_POSITION`

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]Column{}
	for rows.Next() {
		var table, null string
		var c Column
		if err := rows.Scan(&table, &c.Name, &c.Type, &null, &c.Key, &c.Default, &c.Extra); err != nil {
			return nil, err
		}
		c.Nullable = null == "YES"
		out[table] = append(out[table], c)
	}
	return out, rows.Err()
}
