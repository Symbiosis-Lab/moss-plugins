Feature: Self-correcting reference updates
  As a Matters user
  I want image references to be automatically updated after download
  So that my markdown files reference local assets correctly

  Scenario: Updates references when assets already exist
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with remote image URLs
    And the assets already exist locally
    When I run downloadMediaAndUpdate
    Then no downloads should occur
    And all image references should be updated to local paths

  Scenario: Downloads and updates in single pass
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with remote image URLs
    And no assets exist locally
    When I run downloadMediaAndUpdate
    Then all images should be downloaded
    And all image references should be updated to local paths

  Scenario: Resumes correctly after interruption
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with multiple remote image URLs
    And some assets already exist locally
    When I run downloadMediaAndUpdate
    Then only missing assets should be downloaded
    And all image references should be updated to local paths

  Scenario: Handles cross-CDN URLs with same UUID
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with cover and body images using different CDNs
    And both URLs contain the same UUID
    When I run downloadMediaAndUpdate
    Then only one download should occur
    And both cover and body references should point to the same local file

  Scenario: Idempotent operation
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with local image references
    And all assets exist locally
    When I run downloadMediaAndUpdate twice
    Then no downloads should occur
    And the file should not be modified
