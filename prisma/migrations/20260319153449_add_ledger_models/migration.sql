-- CreateTable
CREATE TABLE `LedgerSettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `defaultPeriodBasis` ENUM('CALENDAR', 'PAYDAY') NOT NULL DEFAULT 'CALENDAR',
    `paydayDay` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LedgerSettings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('INCOME', 'EXPENSE', 'SAVING') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerCategory_userId_type_sortOrder_idx`(`userId`, `type`, `sortOrder`),
    UNIQUE INDEX `LedgerCategory_userId_type_name_key`(`userId`, `type`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerBudget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `periodBasis` ENUM('CALENDAR', 'PAYDAY') NOT NULL DEFAULT 'CALENDAR',
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerBudget_userId_periodBasis_idx`(`userId`, `periodBasis`),
    UNIQUE INDEX `LedgerBudget_userId_categoryId_periodBasis_key`(`userId`, `categoryId`, `periodBasis`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `type` ENUM('INCOME', 'EXPENSE', 'SAVING') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'CARD', 'ACCOUNT_TRANSFER') NULL,
    `paymentSourceName` VARCHAR(191) NULL,
    `memo` TEXT NULL,
    `usedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerEntry_userId_usedAt_idx`(`userId`, `usedAt`),
    INDEX `LedgerEntry_userId_type_usedAt_idx`(`userId`, `type`, `usedAt`),
    INDEX `LedgerEntry_userId_paymentMethod_usedAt_idx`(`userId`, `paymentMethod`, `usedAt`),
    INDEX `LedgerEntry_categoryId_usedAt_idx`(`categoryId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerTag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerTag_userId_name_idx`(`userId`, `name`),
    UNIQUE INDEX `LedgerTag_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntryTag` (
    `entryId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,

    INDEX `LedgerEntryTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`entryId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LedgerSettings` ADD CONSTRAINT `LedgerSettings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerCategory` ADD CONSTRAINT `LedgerCategory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudget` ADD CONSTRAINT `LedgerBudget_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerBudget` ADD CONSTRAINT `LedgerBudget_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `LedgerCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `LedgerCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerTag` ADD CONSTRAINT `LedgerTag_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntryTag` ADD CONSTRAINT `LedgerEntryTag_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `LedgerEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntryTag` ADD CONSTRAINT `LedgerEntryTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `LedgerTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
