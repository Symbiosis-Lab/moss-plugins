Feature: Fetch interactions from Nostr relays
  As a Nostr plugin
  I want to fetch social interactions from Nostr relays
  So that I can display comments, likes, and zaps on articles

  Scenario: Fetch comments for an article
    Given a mock Tauri environment
    And a mock relay with 3 comments referencing "https://example.com/posts/hello"
    And the plugin is configured with the mock relay
    When the process hook runs
    Then the result should be successful
    And I should receive 3 interactions
    And each interaction should have source "nostr"
    And each interaction should have interaction_type "comment"
    And each interaction should have an author identifier

  Scenario: Fetch zaps for an article
    Given a mock Tauri environment
    And a mock relay with zaps totaling 50000 sats for "https://example.com/posts/hello"
    And the plugin is configured with the mock relay
    When the process hook runs
    Then the result should be successful
    And I should receive interactions of type "zap"
    And the zap metadata should include amount

  Scenario: Fetch likes for an article
    Given a mock Tauri environment
    And a mock relay with 5 likes for "https://example.com/posts/hello"
    And the plugin is configured with the mock relay
    When the process hook runs
    Then the result should be successful
    And I should receive 5 interactions
    And each interaction should have interaction_type "like"

  Scenario: Handle relay timeout gracefully
    Given a mock Tauri environment
    And a relay that times out after 100ms
    And the plugin is configured with the mock relay
    When the process hook runs
    Then it should return success with empty interactions
    And the result message should mention timeout

  Scenario: Handle empty relay response
    Given a mock Tauri environment
    And a mock relay with no events
    And the plugin is configured with the mock relay
    When the process hook runs with project info
    Then it should return success with empty interactions
