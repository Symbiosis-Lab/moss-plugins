Feature: Worker Pool Concurrency
  As a developer
  I want downloads to respect concurrency limits
  So that we don't overwhelm the server

  Background:
    Given a mock Tauri environment
    And an in-memory filesystem

  Scenario: Respects concurrency limit of 5
    Given 20 images to download
    When I start downloading all images
    Then at most 5 downloads should run concurrently

  Scenario: Tracks download progress
    Given 10 images to download
    When I start downloading all images
    Then progress events should be reported
    And the final progress should show all images completed

  Scenario: Handles mixed success and failure
    Given 5 images where 2 will fail with 404
    When I start downloading all images
    Then 3 downloads should succeed
    And 2 downloads should be marked as failed
    And the result should report both successes and failures
