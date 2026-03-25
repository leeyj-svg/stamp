-- CreateTable
CREATE TABLE `LedgerPlannedPurchase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NULL,
    `title` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `memo` TEXT NULL,
    `plannedFor` DATETIME(3) NOT NULL,
    `status` ENUM('PLANNED', 'HOLD', 'PURCHASED', 'CANCELED') NOT NULL DEFAULT 'PLANNED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerPlannedPurchase_userId_plannedFor_idx`(`userId`, `plannedFor`),
    INDEX `LedgerPlannedPurchase_userId_status_plannedFor_idx`(`userId`, `status`, `plannedFor`),
    INDEX `LedgerPlannedPurchase_categoryId_plannedFor_idx`(`categoryId`, `plannedFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LedgerPlannedPurchase` ADD CONSTRAINT `LedgerPlannedPurchase_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerPlannedPurchase` ADD CONSTRAINT `LedgerPlannedPurchase_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `LedgerCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
