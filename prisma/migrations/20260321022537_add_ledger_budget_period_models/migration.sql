-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `budgetPeriodId` INTEGER NULL,
    ADD COLUMN `excludeFromStats` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `LedgerSettings` ADD COLUMN `weekStartDay` ENUM('SUNDAY', 'MONDAY') NOT NULL DEFAULT 'MONDAY';

-- CreateTable
CREATE TABLE `LedgerBudgetPeriod` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `basis` ENUM('CALENDAR', 'PAYDAY') NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `periodStartAt` DATETIME(3) NOT NULL,
    `periodEndAt` DATETIME(3) NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerBudgetPeriod_userId_basis_status_periodStartAt_idx`(`userId`, `basis`, `status`, `periodStartAt`),
    UNIQUE INDEX `LedgerBudgetPeriod_userId_basis_periodStartAt_periodEndAt_key`(`userId`, `basis`, `periodStartAt`, `periodEndAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerBudgetPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `periodId` INTEGER NOT NULL,
    `type` ENUM('INCOME', 'EXPENSE', 'SAVING') NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `weekCarryMode` ENUM('NONE', 'AUTO', 'MANUAL') NOT NULL DEFAULT 'NONE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerBudgetPlan_type_idx`(`type`),
    UNIQUE INDEX `LedgerBudgetPlan_periodId_type_key`(`periodId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerBudgetCategoryAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `plannedAmount` DECIMAL(12, 2) NOT NULL,
    `isFixed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerBudgetCategoryAllocation_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `LedgerBudgetCategoryAllocation_planId_categoryId_key`(`planId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerBudgetWeekPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planId` INTEGER NOT NULL,
    `weekIndex` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `weekStartAt` DATETIME(3) NOT NULL,
    `weekEndAt` DATETIME(3) NOT NULL,
    `plannedAmount` DECIMAL(12, 2) NOT NULL,
    `carryInAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `carryOutAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerBudgetWeekPlan_planId_status_weekStartAt_idx`(`planId`, `status`, `weekStartAt`),
    UNIQUE INDEX `LedgerBudgetWeekPlan_planId_weekIndex_key`(`planId`, `weekIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LedgerEntry_userId_excludeFromStats_usedAt_idx` ON `LedgerEntry`(`userId`, `excludeFromStats`, `usedAt`);

-- CreateIndex
CREATE INDEX `LedgerEntry_budgetPeriodId_usedAt_idx` ON `LedgerEntry`(`budgetPeriodId`, `usedAt`);

-- AddForeignKey
ALTER TABLE `LedgerBudgetPeriod` ADD CONSTRAINT `LedgerBudgetPeriod_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudgetPlan` ADD CONSTRAINT `LedgerBudgetPlan_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `LedgerBudgetPeriod`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudgetCategoryAllocation` ADD CONSTRAINT `LedgerBudgetCategoryAllocation_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `LedgerBudgetPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudgetCategoryAllocation` ADD CONSTRAINT `LedgerBudgetCategoryAllocation_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `LedgerCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudgetWeekPlan` ADD CONSTRAINT `LedgerBudgetWeekPlan_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `LedgerBudgetPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_budgetPeriodId_fkey` FOREIGN KEY (`budgetPeriodId`) REFERENCES `LedgerBudgetPeriod`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
