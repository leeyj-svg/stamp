CREATE TABLE `DevWorkNote` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `workItemId` INTEGER NOT NULL,
  `contentMd` TEXT NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `DevWorkNote_workItemId_sortOrder_idx`(`workItemId`, `sortOrder`),
  INDEX `DevWorkNote_workItemId_createdAt_idx`(`workItemId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DevWorkNote`
  ADD CONSTRAINT `DevWorkNote_workItemId_fkey`
  FOREIGN KEY (`workItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `DevWorkNote` (`workItemId`, `contentMd`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT
  `id`,
  `contentMd`,
  10,
  COALESCE(`lastWorkedAt`, `updatedAt`, `createdAt`),
  COALESCE(`updatedAt`, `createdAt`)
FROM `DevWorkItem`
WHERE `contentMd` IS NOT NULL
  AND CHAR_LENGTH(TRIM(`contentMd`)) > 0;
