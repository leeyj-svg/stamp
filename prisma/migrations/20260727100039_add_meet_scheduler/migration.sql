-- CreateTable
CREATE TABLE `MeetEvent` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `granularity` ENUM('DATE', 'DATE_TIME') NOT NULL DEFAULT 'DATE',
    `candidateDates` JSON NOT NULL,
    `slotMinutes` INTEGER NULL,
    `startMinute` INTEGER NULL,
    `endMinute` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MeetResponse` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `availability` JSON NOT NULL,
    `writerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MeetResponse_eventId_idx`(`eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MeetResponse` ADD CONSTRAINT `MeetResponse_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `MeetEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
