Feature: Render interactions into HTML
  As a Nostr plugin
  I want to inject social interactions into generated HTML pages
  So that visitors can see and engage with comments, likes, and zaps

  Background:
    Given a mock Tauri environment

  Scenario: Inject interaction island into article page
    Given an HTML file at "posts/hello.html" with content:
      """
      <!DOCTYPE html>
      <html>
      <head><title>Hello</title></head>
      <body>
        <article>
          <h1>Hello World</h1>
          <p>Content here.</p>
        </article>
      </body>
      </html>
      """
    And 3 interactions for target URL "posts/hello.html"
    When the enhance hook runs
    Then the HTML should contain section with id "nostr-interactions"
    And the HTML should contain script with id "interactions-data"
    And the interactions JSON should contain 3 items
    And the HTML should contain a noscript fallback
    And the loader script should be before the closing body tag

  Scenario: Skip HTML files without article tag
    Given an HTML file at "about.html" with content:
      """
      <!DOCTYPE html>
      <html>
      <body>
        <div class="about">
          <h1>About Page</h1>
          <p>This is the about page.</p>
        </div>
      </body>
      </html>
      """
    And 1 interaction for target URL "about.html"
    When the enhance hook runs
    Then the HTML should remain unchanged

  Scenario: No interactions - skip all injection
    Given an HTML file at "posts/empty.html" with content:
      """
      <!DOCTYPE html>
      <html>
      <body>
        <article>
          <h1>Empty Post</h1>
        </article>
      </body>
      </html>
      """
    And no interactions
    When the enhance hook runs
    Then no files should be modified

  Scenario: Copy browser assets to output
    Given an HTML file at "posts/test.html" with an article tag
    And 1 interaction for target URL "posts/test.html"
    When the enhance hook runs
    Then file "js/nostr-social.js" should exist in output
    And file "css/nostr-social.css" should exist in output

  Scenario: Escape HTML in static fallback to prevent XSS
    Given an HTML file at "posts/xss.html" with an article tag
    And an interaction with content containing "<script>alert('xss')</script>"
    When the enhance hook runs
    Then the static fallback should contain escaped content
    And the static fallback should not contain unescaped script tags

  Scenario: Group interactions by target URL
    Given the following HTML files:
      | path              |
      | posts/post1.html  |
      | posts/post2.html  |
      | posts/post3.html  |
    And interactions distributed as:
      | target_url        | count |
      | posts/post1.html  | 2     |
      | posts/post2.html  | 5     |
      | posts/post3.html  | 0     |
    When the enhance hook runs
    Then "posts/post1.html" should have 2 interactions injected
    And "posts/post2.html" should have 5 interactions injected
    And "posts/post3.html" should remain unchanged

  Scenario: Render different interaction types in static fallback
    Given an HTML file at "posts/mixed.html" with an article tag
    And the following interactions for "posts/mixed.html":
      | type    | count |
      | comment | 3     |
      | like    | 10    |
      | zap     | 2     |
    When the enhance hook runs
    Then the static fallback should show like count
    And the static fallback should list comments
    And the static fallback should show zap information

  Scenario: Handle nested article tags correctly
    Given an HTML file at "posts/nested.html" with content:
      """
      <!DOCTYPE html>
      <html>
      <body>
        <article class="main">
          <h1>Main Article</h1>
          <aside>
            <article class="related">
              <h2>Related</h2>
            </article>
          </aside>
        </article>
      </body>
      </html>
      """
    And 2 interactions for target URL "posts/nested.html"
    When the enhance hook runs
    Then the interactions should be injected before the last closing article tag
    And only one interaction section should exist

  Scenario: Preserve existing page scripts and styles
    Given an HTML file at "posts/scripts.html" with content:
      """
      <!DOCTYPE html>
      <html>
      <head>
        <script src="/js/analytics.js"></script>
        <link rel="stylesheet" href="/css/main.css">
      </head>
      <body>
        <article>
          <h1>Test</h1>
        </article>
        <script src="/js/main.js"></script>
      </body>
      </html>
      """
    And 1 interaction for target URL "posts/scripts.html"
    When the enhance hook runs
    Then the original scripts should be preserved
    And the original stylesheets should be preserved
