ALTER TABLE `DevWorkItem`
  ADD COLUMN `githubIssueRepo` VARCHAR(191) NULL,
  ADD COLUMN `githubIssueNumber` INTEGER NULL,
  ADD COLUMN `githubIssueUrl` VARCHAR(512) NULL;

CREATE INDEX `DevWorkItem_githubIssueRepo_githubIssueNumber_idx`
  ON `DevWorkItem`(`githubIssueRepo`, `githubIssueNumber`);
