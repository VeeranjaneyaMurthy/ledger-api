-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('credit', 'debit');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "reference_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_seq_key" ON "transactions"("seq");

-- Both history indexes are intentional: this one serves the type-filtered query,
-- the next serves the unfiltered one, which this composite can't serve well.
CREATE INDEX "transactions_account_id_type_created_at_seq_idx" ON "transactions"("account_id", "type", "created_at" DESC, "seq" DESC);

-- CreateIndex
CREATE INDEX "transactions_account_id_created_at_seq_idx" ON "transactions"("account_id", "created_at" DESC, "seq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_reference_id_key" ON "transactions"("account_id", "reference_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_balance_check" CHECK ("balance" >= 0);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_check" CHECK (length(trim("name")) > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_check" CHECK ("amount" > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reference_id_check" CHECK (length(trim("reference_id")) > 0);

CREATE FUNCTION prevent_transaction_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_immutable
BEFORE UPDATE OR DELETE ON "transactions"
FOR EACH ROW EXECUTE FUNCTION prevent_transaction_change();
