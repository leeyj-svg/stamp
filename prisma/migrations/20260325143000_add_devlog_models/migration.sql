-- CreateTable
CREATE TABLE `DevDiaryPage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `pageDate` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NULL,
    `noteMd` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevDiaryPage_userId_pageDate_idx`(`userId`, `pageDate`),
    UNIQUE INDEX `DevDiaryPage_userId_pageDate_key`(`userId`, `pageDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevWorkItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` ENUM('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'ARCHIVED') NOT NULL DEFAULT 'TODO',
    `contentMd` TEXT NULL,
    `nextAction` TEXT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isMinimized` BOOLEAN NOT NULL DEFAULT false,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `plannedDate` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `lastWorkedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevWorkItem_userId_status_updatedAt_idx`(`userId`, `status`, `updatedAt`),
    INDEX `DevWorkItem_userId_plannedDate_idx`(`userId`, `plannedDate`),
    INDEX `DevWorkItem_userId_isMinimized_updatedAt_idx`(`userId`, `isMinimized`, `updatedAt`),
    INDEX `DevWorkItem_userId_isPinned_updatedAt_idx`(`userId`, `isPinned`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevDiaryPageEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pageId` INTEGER NOT NULL,
    `workItemId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DevDiaryPageEntry_pageId_sortOrder_idx`(`pageId`, `sortOrder`),
    INDEX `DevDiaryPageEntry_workItemId_createdAt_idx`(`workItemId`, `createdAt`),
    UNIQUE INDEX `DevDiaryPageEntry_pageId_workItemId_key`(`pageId`, `workItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevWorkChecklistItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workItemId` INTEGER NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `isDone` BOOLEAN NOT NULL DEFAULT false,
    `isTodayTodo` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevWorkChecklistItem_workItemId_sortOrder_idx`(`workItemId`, `sortOrder`),
    INDEX `DevWorkChecklistItem_workItemId_isDone_sortOrder_idx`(`workItemId`, `isDone`, `sortOrder`),
    INDEX `DevWorkChecklistItem_workItemId_isTodayTodo_isDone_idx`(`workItemId`, `isTodayTodo`, `isDone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevWorkAttachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workItemId` INTEGER NOT NULL,
    `kind` ENUM('IMAGE', 'DOCUMENT', 'ARCHIVE', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `fileName` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `byteSize` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevWorkAttachment_workItemId_sortOrder_idx`(`workItemId`, `sortOrder`),
    INDEX `DevWorkAttachment_workItemId_kind_createdAt_idx`(`workItemId`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevWorkLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `workItemId` INTEGER NOT NULL,
    `logDate` DATETIME(3) NOT NULL,
    `type` ENUM('CREATED', 'STATUS_CHANGED', 'NOTE_UPDATED', 'CHECKLIST_UPDATED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'MINIMIZED', 'RESTORED') NOT NULL DEFAULT 'NOTE_UPDATED',
    `message` VARCHAR(191) NULL,
    `noteMd` TEXT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DevWorkLog_userId_logDate_createdAt_idx`(`userId`, `logDate`, `createdAt`),
    INDEX `DevWorkLog_workItemId_createdAt_idx`(`workItemId`, `createdAt`),
    INDEX `DevWorkLog_workItemId_type_createdAt_idx`(`workItemId`, `type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DevDiaryPage` ADD CONSTRAINT `DevDiaryPage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevWorkItem` ADD CONSTRAINT `DevWorkItem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevDiaryPageEntry` ADD CONSTRAINT `DevDiaryPageEntry_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `DevDiaryPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevDiaryPageEntry` ADD CONSTRAINT `DevDiaryPageEntry_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevWorkChecklistItem` ADD CONSTRAINT `DevWorkChecklistItem_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevWorkAttachment` ADD CONSTRAINT `DevWorkAttachment_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevWorkLog` ADD CONSTRAINT `DevWorkLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevWorkLog` ADD CONSTRAINT `DevWorkLog_workItemId_fkey` FOREIGN KEY (`workItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
