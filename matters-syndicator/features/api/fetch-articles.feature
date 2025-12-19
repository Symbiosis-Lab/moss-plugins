Feature: Fetch Articles from Matters API
  As a plugin
  I want to fetch articles via GraphQL
  So that I can sync content locally

  @e2e @real-api
  Scenario: Fetch public user articles
    Given the matters.icu test environment
    When I query articles for user "Matty"
    Then I should receive a list of articles
    And each article should have id, title, shortHash, and content

  @e2e @real-api
  Scenario: Handle pagination for users with many articles
    Given the matters.icu test environment
    When I fetch all articles for user "Matty" with pagination
    Then I should receive all articles across multiple pages
    And all articles should have unique shortHashes

  @e2e @real-api
  Scenario: Fetch user profile
    Given the matters.icu test environment
    When I query profile for user "Matty"
    Then I should receive profile with userName and displayName
    And the profile should have a language setting

  @e2e @real-api
  Scenario: Fetch user collections
    Given the matters.icu test environment
    When I query collections for user "Matty"
    Then I should receive a list of collections
    And each collection should have id, title, and articles

  @e2e @real-api
  Scenario: Handle non-existent user gracefully
    Given the matters.icu test environment
    When I query articles for user "nonexistent_user_xyz_12345"
    Then the query should return null user
