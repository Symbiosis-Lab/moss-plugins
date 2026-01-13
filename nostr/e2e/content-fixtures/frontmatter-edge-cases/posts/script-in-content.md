---
title: XSS Test Post
date: 2024-01-15
---

# Post With Script Tags

Testing XSS protection:

<script>alert('xss')</script>

And also:

```html
<script>alert('in code block')</script>
```

And an image with onerror:

<img src="x" onerror="alert('img xss')">
