package migrations_test

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/gofeatureflag/flag-management-system/server/management/config"
	"github.com/gofeatureflag/flag-management-system/server/management/db/migrations"
	"github.com/gofeatureflag/flag-management-system/server/management/internal/testutil"
	"github.com/gofeatureflag/flag-management-system/server/management/repository"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Replicas starting together all call Up: the lock lets exactly one apply each
// migration, and a later call has nothing left to do.
func TestUpConcurrentAndIdempotent(t *testing.T) {
	db, err := repository.NewDB(t.Context(), config.DBConfig{URL: testutil.EmptyDatabase(t), MaxConns: 8})
	require.NoError(t, err)
	defer db.Close()

	const callers = 3
	applied := make([]int, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range callers {
		wg.Go(func() { applied[i], errs[i] = migrations.Up(context.Background(), db.Pool) })
	}
	wg.Wait()
	total := 0
	for i := range callers {
		require.NoError(t, errs[i])
		total += applied[i]
	}
	files, err := filepath.Glob("*.sql")
	require.NoError(t, err)
	assert.Equal(t, len(files), total, "each migration applied once")

	n, err := migrations.Up(t.Context(), db.Pool)
	require.NoError(t, err)
	assert.Zero(t, n)
	var tables int
	require.NoError(t, db.Pool.QueryRow(t.Context(),
		`SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version'`).Scan(&tables))
	assert.Equal(t, 10, tables)
}

// Every migration's Down undoes its Up: down to zero leaves no table, and
// migrating up again rebuilds the same schema.
func TestDownThenUpAgain(t *testing.T) {
	db, err := repository.NewDB(t.Context(), config.DBConfig{URL: testutil.EmptyDatabase(t), MaxConns: 4})
	require.NoError(t, err)
	defer db.Close()
	tables := func() []string {
		rows, err := db.Pool.Query(t.Context(), `SELECT tablename FROM pg_tables
			WHERE schemaname = 'public' AND tablename <> 'goose_db_version' ORDER BY tablename`)
		require.NoError(t, err)
		names, err := pgx.CollectRows(rows, pgx.RowTo[string])
		require.NoError(t, err)
		return names
	}
	columns := func() int {
		var n int
		require.NoError(t, db.Pool.QueryRow(t.Context(),
			`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'
			 AND table_name <> 'goose_db_version'`).Scan(&n))
		return n
	}

	_, err = migrations.Up(t.Context(), db.Pool)
	require.NoError(t, err)
	schema, cols := tables(), columns()
	require.NotEmpty(t, schema)

	sqlDB := stdlib.OpenDBFromPool(db.Pool)
	defer func() { _ = sqlDB.Close() }()
	p, err := migrations.NewProvider(sqlDB)
	require.NoError(t, err)
	_, err = p.DownTo(t.Context(), 0)
	require.NoError(t, err)
	assert.Empty(t, tables(), "down to zero drops every table")

	_, err = migrations.Up(t.Context(), db.Pool)
	require.NoError(t, err)
	assert.Equal(t, schema, tables())
	assert.Equal(t, cols, columns(), "same columns after a round-trip")
}

// Upgrading to the updatedBy migration must not change the config GO Feature Flag reads for an existing flag.
func TestUpdatedByUpgradeKeepsGoffConfig(t *testing.T) {
	db, err := repository.NewDB(t.Context(), config.DBConfig{URL: testutil.EmptyDatabase(t), MaxConns: 4})
	require.NoError(t, err)
	defer db.Close()
	ctx := t.Context()
	sqlDB := stdlib.OpenDBFromPool(db.Pool)
	defer func() { _ = sqlDB.Close() }()
	p, err := migrations.NewProvider(sqlDB)
	require.NoError(t, err)
	_, err = p.UpTo(ctx, 4)
	require.NoError(t, err)

	var flagID string
	require.NoError(t, db.Pool.QueryRow(ctx, `
		WITH u AS (INSERT INTO users (email, name) VALUES ('jane@example.com', 'Jane Doe') RETURNING id),
		     c AS (INSERT INTO companies (display_name) VALUES ('Acme') RETURNING id),
		     t AS (INSERT INTO teams (name, company_id) SELECT 'Platform', id FROM c RETURNING id),
		     fs AS (INSERT INTO flagsets (team_id, name) SELECT id, 'prod' FROM t RETURNING id)
		INSERT INTO flags (flagset_id, name) SELECT id, 'my-flag' FROM fs RETURNING id`).Scan(&flagID))
	_, err = db.Pool.Exec(ctx, `
		WITH v AS (INSERT INTO flag_versions (flag_id, version_number, payload, created_by)
		           SELECT $1, 1, '{"variations":{"on":true},"defaultRule":{"variation":"on"},"metadata":{"team":"core"}}', id
		           FROM users RETURNING id)
		UPDATE flags SET current_version_id = (SELECT id FROM v) WHERE id = $1`, flagID)
	require.NoError(t, err)

	snapshot := func() string {
		var config string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT config::text FROM goff_flags WHERE flag_name = 'my-flag'`).Scan(&config))
		return config
	}
	before := snapshot()

	_, err = migrations.Up(ctx, db.Pool)
	require.NoError(t, err)
	var updatedBy *string
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT updated_by_name FROM flags WHERE id = $1`, flagID).Scan(&updatedBy))
	assert.Nil(t, updatedBy, "existing flags are not backfilled")
	assert.Equal(t, before, snapshot(), "goff_flags config is byte-identical after the upgrade")
}
