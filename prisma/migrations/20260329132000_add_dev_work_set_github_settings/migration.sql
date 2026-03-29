ALTER TABLE `DevWorkSet`
  ADD COLUMN `githubIssueRepoOwner` VARCHAR(191) NULL,
  ADD COLUMN `githubIssueRepoName` VARCHAR(191) NULL,
  ADD COLUMN `githubIssueLabels` VARCHAR(512) NULL,
  ADD COLUMN `githubIssueTokenEncrypted` TEXT NULL;
