-- CreateTable
CREATE TABLE `RoutineType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `weeklyGoalCount` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoutineType_userId_sortOrder_isActive_idx`(`userId`, `sortOrder`, `isActive`),
    UNIQUE INDEX `RoutineType_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoutineRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `typeId` INTEGER NOT NULL,
    `status` ENUM('SUCCESS', 'FAIL', 'SKIPPED') NOT NULL DEFAULT 'SUCCESS',
    `recordDate` DATETIME(3) NOT NULL,
    `performedAt` DATETIME(3) NULL,
    `photoUrl1` VARCHAR(191) NULL,
    `photoUrl2` VARCHAR(191) NULL,
    `memo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoutineRecord_userId_recordDate_idx`(`userId`, `recordDate`),
    INDEX `RoutineRecord_userId_status_recordDate_idx`(`userId`, `status`, `recordDate`),
    INDEX `RoutineRecord_userId_typeId_recordDate_idx`(`userId`, `typeId`, `recordDate`),
    INDEX `RoutineRecord_typeId_recordDate_idx`(`typeId`, `recordDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoutineDayNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `recordDate` DATETIME(3) NOT NULL,
    `memo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoutineDayNote_userId_recordDate_idx`(`userId`, `recordDate`),
    UNIQUE INDEX `RoutineDayNote_userId_recordDate_key`(`userId`, `recordDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RoutineType` ADD CONSTRAINT `RoutineType_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutineRecord` ADD CONSTRAINT `RoutineRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutineRecord` ADD CONSTRAINT `RoutineRecord_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `RoutineType`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutineDayNote` ADD CONSTRAINT `RoutineDayNote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
