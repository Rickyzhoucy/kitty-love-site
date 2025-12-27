-- CreateTable
CREATE TABLE "SiteConfigHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteConfigHistory_pkey" PRIMARY KEY ("id")
);
