BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    api_key_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    owner_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    plan_type VARCHAR(20) NOT NULL CHECK (plan_type IN ('account', 'user')),
    name VARCHAR(100) NOT NULL,
    monthly_allowance BIGINT NOT NULL CHECK (monthly_allowance >= 0),
    max_units_per_request BIGINT NOT NULL CHECK (max_units_per_request > 0),
    is_predefined BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (is_predefined = TRUE AND owner_account_id IS NULL)
        OR
        (is_predefined = FALSE AND owner_account_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_predefined_name
ON plans (plan_type, name)
WHERE is_predefined = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_custom_name
ON plans (owner_account_id, plan_type, name)
WHERE is_predefined = FALSE;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS account_plan_id INTEGER REFERENCES plans(id);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_account ON users (id, account_id);

CREATE TABLE IF NOT EXISTS metering_requests (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    request_id VARCHAR(255) NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    accepted BOOLEAN NOT NULL,
    rejection_scope VARCHAR(20) CHECK (rejection_scope IN ('account', 'user')),
    rejection_reason TEXT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_metering_user_account
        FOREIGN KEY (user_id, account_id) REFERENCES users (id, account_id),
    CONSTRAINT uq_metering_account_request UNIQUE (account_id, request_id),
    CONSTRAINT chk_metering_decision CHECK (
        (accepted = TRUE AND rejection_scope IS NULL AND rejection_reason IS NULL)
        OR
        (accepted = FALSE AND rejection_scope IS NOT NULL AND rejection_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_metering_account_month
ON metering_requests (account_id, processed_at) WHERE accepted = TRUE;

CREATE INDEX IF NOT EXISTS idx_metering_user_month
ON metering_requests (account_id, user_id, processed_at) WHERE accepted = TRUE;

CREATE INDEX IF NOT EXISTS idx_metering_history
ON metering_requests (account_id, processed_at DESC, id DESC);

INSERT INTO plans (
    owner_account_id, plan_type, name,
    monthly_allowance, max_units_per_request, is_predefined
)
SELECT NULL, seed.plan_type, seed.name,
       seed.monthly_allowance, seed.max_units_per_request, TRUE
FROM (
    VALUES
        ('account', 'Starter', 10000::BIGINT, 100::BIGINT),
        ('account', 'Pro', 100000::BIGINT, 1000::BIGINT),
        ('user', 'Basic', 1000::BIGINT, 20::BIGINT),
        ('user', 'Premium', 5000::BIGINT, 100::BIGINT)
) AS seed(plan_type, name, monthly_allowance, max_units_per_request)
WHERE NOT EXISTS (
    SELECT 1 FROM plans p
    WHERE p.is_predefined = TRUE
      AND p.plan_type = seed.plan_type
      AND p.name = seed.name
);

COMMIT;
