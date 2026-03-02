CREATE TABLE `EventLike` (
  `eventId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`eventId`, `userId`),
  INDEX `EventLike_userId_idx`(`userId`),
  CONSTRAINT `EventLike_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EventLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EventCategoryManager` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` VARCHAR(191) NOT NULL,
  `categoryId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `EventCategoryManager_userId_categoryId_key`(`userId`, `categoryId`),
  INDEX `EventCategoryManager_categoryId_idx`(`categoryId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `EventCategoryManager_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EventCategoryManager_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `EventCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
