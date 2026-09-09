-- AlterTable
ALTER TABLE "movement_records" ADD COLUMN "client_request_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "movement_records_client_request_id_key" ON "movement_records"("client_request_id");
