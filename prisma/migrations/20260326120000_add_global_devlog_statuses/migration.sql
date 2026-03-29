-- CreateTable
CREATE TABLE `DevWorkStatusDefinition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `statusKey` VARCHAR(64) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DevWorkStatusDefinition_userId_statusKey_key`(`userId`, `statusKey`),
    INDEX `DevWorkStatusDefinition_userId_sortOrder_idx`(`userId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `DevWorkItem`
    MODIFY `status` VARCHAR(64) NOT NULL DEFAULT 'TODO';

-- Seed default global statuses for existing devlog users
INSERT INTO `DevWorkStatusDefinition` (`userId`, `statusKey`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, 'TODO', '할 일', 10, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

INSERT INTO `DevWorkStatusDefinition` (`userId`, `statusKey`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, 'IN_PROGRESS', '진행중', 20, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

INSERT INTO `DevWorkStatusDefinition` (`userId`, `statusKey`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, 'BLOCKED', '막힘', 30, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

INSERT INTO `DevWorkStatusDefinition` (`userId`, `statusKey`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, 'DONE', '완료', 40, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

INSERT INTO `DevWorkStatusDefinition` (`userId`, `statusKey`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `source`.`userId`, 'ARCHIVED', '보관', 50, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT DISTINCT `userId` FROM `DevWorkItem`
    UNION
    SELECT DISTINCT `userId` FROM `DevDiaryPage`
) AS `source`;

-- AddForeignKey
ALTER TABLE `DevWorkStatusDefinition`
ADD CONSTRAINT `DevWorkStatusDefinition_userId_fkey`
FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
