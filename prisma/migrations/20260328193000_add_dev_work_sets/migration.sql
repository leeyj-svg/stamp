CREATE TABLE `DevWorkSet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DevWorkSet_userId_sortOrder_idx`(`userId`, `sortOrder`),
    INDEX `DevWorkSet_userId_isDefault_idx`(`userId`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `DevWorkSet` (`userId`, `name`, `sortOrder`, `isDefault`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, '기본 세트', 10, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

ALTER TABLE `DevDiaryPage`
    ADD COLUMN `workSetId` INTEGER NULL;

UPDATE `DevDiaryPage` AS `page`
INNER JOIN `DevWorkSet` AS `workSet`
    ON `workSet`.`userId` = `page`.`userId`
   AND `workSet`.`isDefault` = true
SET `page`.`workSetId` = `workSet`.`id`
WHERE `page`.`workSetId` IS NULL;

ALTER TABLE `DevDiaryPage`
    DROP INDEX `DevDiaryPage_userId_pageDate_key`,
    DROP INDEX `DevDiaryPage_userId_pageDate_idx`,
    MODIFY `workSetId` INTEGER NOT NULL,
    ADD INDEX `DevDiaryPage_userId_workSetId_pageDate_idx`(`userId`, `workSetId`, `pageDate`),
    ADD UNIQUE INDEX `DevDiaryPage_userId_workSetId_pageDate_key`(`userId`, `workSetId`, `pageDate`);

ALTER TABLE `DevWorkItem`
    ADD COLUMN `workSetId` INTEGER NULL;

UPDATE `DevWorkItem` AS `item`
INNER JOIN `DevWorkSet` AS `workSet`
    ON `workSet`.`userId` = `item`.`userId`
   AND `workSet`.`isDefault` = true
SET `item`.`workSetId` = `workSet`.`id`
WHERE `item`.`workSetId` IS NULL;

ALTER TABLE `DevWorkItem`
    DROP INDEX `DevWorkItem_userId_status_updatedAt_idx`,
    DROP INDEX `DevWorkItem_userId_parentWorkItemId_updatedAt_idx`,
    DROP INDEX `DevWorkItem_userId_plannedDate_idx`,
    DROP INDEX `DevWorkItem_userId_isMinimized_updatedAt_idx`,
    DROP INDEX `DevWorkItem_userId_isPinned_updatedAt_idx`,
    MODIFY `workSetId` INTEGER NOT NULL,
    ADD INDEX `DevWorkItem_userId_workSetId_status_updatedAt_idx`(`userId`, `workSetId`, `status`, `updatedAt`),
    ADD INDEX `DevWorkItem_userId_workSetId_parentWorkItemId_updatedAt_idx`(`userId`, `workSetId`, `parentWorkItemId`, `updatedAt`),
    ADD INDEX `DevWorkItem_userId_workSetId_plannedDate_idx`(`userId`, `workSetId`, `plannedDate`),
    ADD INDEX `DevWorkItem_userId_workSetId_isMinimized_updatedAt_idx`(`userId`, `workSetId`, `isMinimized`, `updatedAt`),
    ADD INDEX `DevWorkItem_userId_workSetId_isPinned_updatedAt_idx`(`userId`, `workSetId`, `isPinned`, `updatedAt`);

ALTER TABLE `DevWorkSet`
    ADD CONSTRAINT `DevWorkSet_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DevDiaryPage`
    ADD CONSTRAINT `DevDiaryPage_workSetId_fkey`
    FOREIGN KEY (`workSetId`) REFERENCES `DevWorkSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DevWorkItem`
    ADD CONSTRAINT `DevWorkItem_workSetId_fkey`
    FOREIGN KEY (`workSetId`) REFERENCES `DevWorkSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
