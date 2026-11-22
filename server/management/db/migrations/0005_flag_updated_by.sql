-- +goose Up
-- +goose StatementBegin
-- updated_by_name snapshots the display name of whoever last changed what the relay proxy serves, so renaming or deleting a user changes no flag.
ALTER TABLE flags ADD COLUMN updated_by_name TEXT;

-- The editor's name reaches GO Feature Flag as metadata.updatedBy, so its notifiers can say who made a change.
CREATE OR REPLACE VIEW goff_flags AS
SELECT f.name             AS flag_name,
       f.flagset_id       AS flagset,
       CASE WHEN f.updated_by_name IS NULL THEN fv.payload::jsonb
            ELSE jsonb_set(fv.payload::jsonb, '{metadata}',
                 CASE WHEN jsonb_typeof(fv.payload::jsonb -> 'metadata') = 'object'
                      THEN fv.payload::jsonb -> 'metadata' ELSE '{}'::jsonb END
                 || jsonb_build_object('updatedBy', f.updated_by_name))
       END || jsonb_build_object('disable', f.disabled) AS config
FROM flags f
JOIN flagsets fs ON fs.id = f.flagset_id
JOIN flag_versions fv ON fv.id = f.current_version_id
WHERE f.deleted_at IS NULL AND fs.deleted_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE VIEW goff_flags AS
SELECT f.name             AS flag_name,
       f.flagset_id       AS flagset,
       fv.payload::jsonb || jsonb_build_object('disable', f.disabled) AS config
FROM flags f
JOIN flagsets fs ON fs.id = f.flagset_id
JOIN flag_versions fv ON fv.id = f.current_version_id
WHERE f.deleted_at IS NULL AND fs.deleted_at IS NULL;
ALTER TABLE flags DROP COLUMN updated_by_name;
-- +goose StatementEnd
