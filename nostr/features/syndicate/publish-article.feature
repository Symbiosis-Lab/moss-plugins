Feature: Publish articles to Nostr
  As a Nostr plugin
  I want to publish articles to Nostr relays as long-form content
  So that articles can be discovered and shared on the Nostr network

  Background:
    Given a mock Tauri environment
    And a mock relay for publishing

  Scenario: Publish new article as NIP-23 long-form content
    Given an article:
      | title   | My First Post                      |
      | content | This is the full article content.  |
      | tags    | nostr, decentralization            |
      | url     | https://example.com/posts/first    |
    And a configured private key
    When the syndicate hook runs
    Then the result should be successful
    And a kind 30023 event should be published
    And the event should have a "d" tag with the article identifier
    And the event should have a "title" tag with "My First Post"
    And the event should have "t" tags for each article tag
    And the event content should contain the article content

  Scenario: Skip publishing without private key
    Given an article with title "Test Post" and content "Test content"
    And no configured private key
    When the syndicate hook runs
    Then the result should be successful
    And no events should be published
    And the result message should indicate missing signing key

  Scenario: Handle relay publish failure
    Given an article with title "Test Post" and content "Test content"
    And a configured private key
    And the relay rejects publishes
    When the syndicate hook runs
    Then the result should indicate partial failure
    And the result message should mention relay failure

  Scenario: Publish to multiple relays
    Given an article with title "Multi-Relay Post" and content "Content"
    And a configured private key
    And relays "wss://relay1.example.com" and "wss://relay2.example.com" are configured
    When the syndicate hook runs
    Then the event should be published to both relays

  Scenario: Include article metadata in event tags
    Given an article:
      | title       | Complete Article                    |
      | content     | Full article content here.          |
      | tags        | tech, programming, rust             |
      | url         | https://example.com/posts/complete  |
      | summary     | A brief summary                     |
      | image       | https://example.com/cover.jpg       |
    And a configured private key
    When the syndicate hook runs
    Then the event should have a "summary" tag if provided
    And the event should have an "image" tag if provided
    And the event should have a "published_at" tag

  Scenario: Generate consistent "d" tag from URL
    Given articles:
      | url                                    |
      | https://example.com/posts/my-article   |
      | https://example.com/posts/other        |
    And a configured private key
    When the syndicate hook runs
    Then each article should have a unique "d" tag
    And the "d" tag should be derived from the URL path

  Scenario: Publish multiple articles
    Given 3 articles to publish
    And a configured private key
    When the syndicate hook runs
    Then the result should be successful
    And 3 events should be published

  Scenario: Sign event with NIP-19 nsec key
    Given an article with title "Signed Post" and content "Content to sign"
    And a configured private key in nsec format
    When the syndicate hook runs
    Then the published event should have a valid signature
    And the event pubkey should match the private key

  Scenario: Empty articles list
    Given no articles to publish
    And a configured private key
    When the syndicate hook runs
    Then the result should be successful
    And no events should be published

  Scenario: Skip already published articles
    Given an article that was previously published
    And a configured private key
    When the syndicate hook runs
    Then no duplicate events should be published
