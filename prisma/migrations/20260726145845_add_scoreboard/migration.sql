-- CreateTable
CREATE TABLE `Scoreboard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'teams',
    `step` INTEGER NOT NULL DEFAULT 1,
    `soundOn` BOOLEAN NOT NULL DEFAULT true,
    `hostName` VARCHAR(191) NOT NULL DEFAULT '사회자',
    `hostScore` INTEGER NOT NULL DEFAULT 0,
    `hostHidden` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScoreTeam` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `x` DOUBLE NOT NULL DEFAULT 10,
    `y` DOUBLE NOT NULL DEFAULT 10,
    `w` INTEGER NOT NULL DEFAULT 200,
    `order` INTEGER NOT NULL DEFAULT 0,
    `boardId` INTEGER NOT NULL,

    INDEX `ScoreTeam_boardId_idx`(`boardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScoreTeam` ADD CONSTRAINT `ScoreTeam_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Scoreboard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
