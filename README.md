# 𝕏 — Frontend for Twitter-Clone

A sleek, no-build vanilla HTML/CSS/JS client styled after **𝕏** (Twitter) with a pure pitch-black (`#000000`) theme, responsive 3-column layout, authentic SVG iconography, modal replies, and seamless animations.

## Features & Highlights

- **Pure Black 𝕏 Theme**: `#000000` main background, `#16181c` widgets, `#202327` search pill and input fields, and `#2f3336` hairline borders.
- **Official 3-Column Layout**:
  - **Left Rail**: 𝕏 logo, Home, Explore, Bookmarks, Profile, pill "Post" action, and bottom user account popover.
  - **Center Timeline**: Translucent sticky header with blur (`backdrop-filter: blur(12px)`), "For you" / "Following" / "Bookmarks" tabs, inline composer with auto-resize and character limit counter, and seamless stream of tweets.
  - **Right Sidebar**: Glassy search pill, "What’s happening" trending hashtag cards, and "Who to follow" suggestions.
- **Interactive 𝕏 Reply Modal**: Replaces basic browser prompts with a full reply modal showing the parent tweet with thread connector line, reply composer, character counter, and instant API submission.
- **Authentic Profile Page**: Profile banner, overlapping circular avatar, stats (Following, Followers), and user's original posts.
- **Full Auth Flow**: Landing screen with 𝕏 logo, "Happening now" branding, and toggleable Sign In / Register forms.

## Pages

- `index.html` — Landing page with 𝕏 sign in / registration
- `feed.html` — Main timeline ("For you", "Following", "Bookmarks"), composer, reply modal, search, trending hashtags
- `profile.html` — User profile, banner, statistics, user's posts

## Running it

1. Start your backend: `npm run dev` in your Twitter-Clone repo (default port **7000**).
2. Serve this folder statically:
   ```bash
   npx serve .
   # or
   python3 -m http.server 3000
   ```
3. If your backend is hosted on a different port, set it in your browser console:
   ```js
   localStorage.setItem('api_base', 'http://localhost:YOUR_PORT/api');
   ```
