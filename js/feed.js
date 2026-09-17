requireAuth();

const me = getUser();
let currentTab = 'forYou'; // 'forYou' | 'following' | 'bookmarks' | 'notifications'
let activeTweetsCache = [];
let bookmarkedIds = new Set();
let myRetweetedIds = new Set();
let activeReplyTweet = null;
let activeQuoteTweet = null;
let activeDetailTweet = null;
let pendingDeleteTweetId = null;
let lastSearchTweets = [];
let newPostsPollingInterval = null;

// Persistent tracking of deleted tweet IDs across pages & tabs
const locallyDeletedTweetIds = new Set(JSON.parse(localStorage.getItem('deleted_tweet_ids') || '[]'));

// Global feed tweet map for quote & retweet resolution
const feedTweetMap = new Map();

async function resolveQuotedTweets(items) {
  items.forEach(t => {
    if (t && t._id) feedTweetMap.set(t._id, t);
    if (t && t.retweetOf && typeof t.retweetOf === 'object' && t.retweetOf._id) {
      feedTweetMap.set(t.retweetOf._id, t.retweetOf);
    }
  });

  const missingIds = items
    .filter(it => it.retweetOf && typeof it.retweetOf === 'string' && !feedTweetMap.has(it.retweetOf))
    .map(it => it.retweetOf);

  if (missingIds.length > 0) {
    const uniqueIds = [...new Set(missingIds)];
    await Promise.all(
      uniqueIds.map(id =>
        api(`/tweets/${id}`, { auth: false })
          .then(t => { if (t && t._id) feedTweetMap.set(t._id, t); })
          .catch(() => null)
      )
    );
  }
}

// -------------------------------------------------------------
// Author Header Formatter (Prevents awkward "test @test · 33m")
// -------------------------------------------------------------
function renderAuthorHeader(author, createdAt) {
  const username = author?.username || 'user';
  const name = (author?.name || '').trim();
  const authorProfileUrl = `profile.html?user=${encodeURIComponent(username)}&id=${author?._id || ''}`;

  // If author has a distinct display name (e.g. "Hosam" while username is "hosam7")
  if (name && name.toLowerCase() !== username.toLowerCase()) {
    return `
      <div class="tweet-author-info">
        <a href="${authorProfileUrl}" class="author-link tweet-author-name">${escapeHtml(name)}</a>
        <a href="${authorProfileUrl}" class="author-link tweet-author-handle">@${escapeHtml(username)}</a>
        <span class="tweet-dot">·</span>
        <span class="tweet-time">${timeAgo(createdAt)}</span>
      </div>
    `;
  }

  // When username and display name are the same, show ONLY clean bold handle + time
  return `
    <div class="tweet-author-info">
      <a href="${authorProfileUrl}" class="author-link tweet-author-name">@${escapeHtml(username)}</a>
      <span class="tweet-dot">·</span>
      <span class="tweet-time">${timeAgo(createdAt)}</span>
    </div>
  `;
}

// -------------------------------------------------------------
// Initialize User UI Elements
// -------------------------------------------------------------
function initUserUI() {
  const username = me?.username || 'user';
  document.getElementById('sidebarName').textContent = username;
  document.getElementById('sidebarHandle').textContent = `@${username}`;
  document.getElementById('dropdownHandle').textContent = `@${username}`;
  
  const avatarHtml = getAvatar(username, 'md');
  document.getElementById('sidebarAvatar').innerHTML = avatarHtml;
  document.getElementById('composerAvatar').innerHTML = avatarHtml;
  document.getElementById('modalMyAvatar').innerHTML = avatarHtml;
  document.getElementById('quoteMyAvatar').innerHTML = avatarHtml;

  const composeAvatarEl = document.getElementById('modalComposeAvatar');
  if (composeAvatarEl) composeAvatarEl.innerHTML = avatarHtml;

  const detailAvatarEl = document.getElementById('detailMyAvatar');
  if (detailAvatarEl) detailAvatarEl.innerHTML = avatarHtml;
}

initUserUI();

// -------------------------------------------------------------
// Left Sidebar Menu & Account Dropdown
// -------------------------------------------------------------
const userPillBtn = document.getElementById('userPillBtn');
const userDropdown = document.getElementById('userDropdown');

userPillBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!userDropdown.contains(e.target) && !userPillBtn.contains(e.target)) {
    userDropdown.classList.remove('show');
  }
  if (!e.target.closest('.repost-popover') && !e.target.closest('[data-action="retweet-trigger"]')) {
    document.querySelectorAll('.repost-popover').forEach(p => p.remove());
  }
  if (!e.target.closest('.tweet-options-popover') && !e.target.closest('[data-action="more-options"]')) {
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());
  }
  if (!e.target.closest('.emoji-popover') && !e.target.closest('[title="Emoji"]')) {
    document.querySelectorAll('.emoji-popover').forEach(p => p.remove());
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  clearToken();
  window.location.href = 'index.html';
});

// -------------------------------------------------------------
// 𝕏 Dedicated Compose Post Modal (Sidebar "Post" button)
// -------------------------------------------------------------
const composeModal = document.getElementById('composeModal');
const closeComposeModalBtn = document.getElementById('closeComposeModalBtn');
const modalComposeText = document.getElementById('modalComposeText');
const modalComposeCharCounter = document.getElementById('modalComposeCharCounter');
const modalComposeSubmitBtn = document.getElementById('modalComposeSubmitBtn');

function openComposeModal() {
  if (!composeModal) return;
  modalComposeText.value = '';
  modalComposeText.style.height = 'auto';
  modalComposeCharCounter.textContent = '280';
  modalComposeCharCounter.className = 'char-counter';
  modalComposeSubmitBtn.disabled = true;
  composeModal.classList.add('open');
  modalComposeText.focus();
}

function closeComposeModal() {
  if (!composeModal) return;
  composeModal.classList.remove('open');
}

document.getElementById('btnSidebarPost').addEventListener('click', (e) => {
  e.preventDefault();
  openComposeModal();
});

if (closeComposeModalBtn) {
  closeComposeModalBtn.addEventListener('click', closeComposeModal);
}

if (composeModal) {
  composeModal.addEventListener('click', (e) => {
    if (e.target === composeModal) closeComposeModal();
  });
}

if (modalComposeText) {
  modalComposeText.addEventListener('input', () => {
    modalComposeText.style.height = 'auto';
    modalComposeText.style.height = `${modalComposeText.scrollHeight}px`;

    const remaining = 280 - modalComposeText.value.length;
    modalComposeCharCounter.textContent = remaining;

    if (remaining < 0) {
      modalComposeCharCounter.className = 'char-counter limit-exceeded';
      modalComposeSubmitBtn.disabled = true;
    } else if (remaining <= 20) {
      modalComposeCharCounter.className = 'char-counter limit-near';
      modalComposeSubmitBtn.disabled = !modalComposeText.value.trim();
    } else {
      modalComposeCharCounter.className = 'char-counter';
      modalComposeSubmitBtn.disabled = !modalComposeText.value.trim();
    }
  });
}

if (modalComposeSubmitBtn) {
  modalComposeSubmitBtn.addEventListener('click', async () => {
    const content = modalComposeText.value.trim();
    if (!content) return;

    modalComposeSubmitBtn.disabled = true;
    try {
      await api('/tweets', {
        method: 'POST',
        body: { content },
      });
      closeComposeModal();
      toast('Your post was sent');
      loadActiveFeed();
    } catch (err) {
      toast(err.message);
    } finally {
      modalComposeSubmitBtn.disabled = false;
    }
  });
}

// -------------------------------------------------------------
// Tabs Navigation ("For you", "Following", "Notifications", "Bookmarks")
// -------------------------------------------------------------
const tabForYou = document.getElementById('tabForYou');
const tabFollowing = document.getElementById('tabFollowing');
const tabsStrip = document.getElementById('tabsStrip');
const composerSection = document.getElementById('composerSection');
const navHome = document.getElementById('navHome');
const navBookmarks = document.getElementById('navBookmarks');
const navNotifications = document.getElementById('navNotifications');
const navExplore = document.getElementById('navExplore');
const timelineTitle = document.getElementById('timelineTitle');

tabForYou.addEventListener('click', () => switchTab('forYou'));
tabFollowing.addEventListener('click', () => switchTab('following'));

navHome.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('forYou');
});

navBookmarks.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('bookmarks');
});

navNotifications.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('notifications');
});

navExplore.addEventListener('click', (e) => {
  e.preventDefault();
  const searchInput = document.getElementById('searchInput');
  searchInput.focus();
  searchInput.scrollIntoView({ behavior: 'smooth' });
});

function switchTab(tab) {
  currentTab = tab;

  tabForYou.classList.toggle('active', tab === 'forYou');
  tabFollowing.classList.toggle('active', tab === 'following');

  navHome.classList.toggle('active', tab === 'forYou' || tab === 'following');
  navBookmarks.classList.toggle('active', tab === 'bookmarks');
  navNotifications.classList.toggle('active', tab === 'notifications');

  // Hide new posts pill when leaving 'forYou'
  const newPostsPill = document.getElementById('newPostsPill');
  if (newPostsPill) newPostsPill.style.display = 'none';

  if (tab === 'bookmarks') {
    timelineTitle.textContent = 'Bookmarks';
    tabsStrip.style.display = 'none';
    composerSection.style.display = 'none';
  } else if (tab === 'notifications') {
    timelineTitle.textContent = 'Notifications';
    tabsStrip.style.display = 'none';
    composerSection.style.display = 'none';
  } else {
    timelineTitle.textContent = 'Home';
    tabsStrip.style.display = 'flex';
    composerSection.style.display = 'flex';
  }

  loadActiveFeed();
}

// -------------------------------------------------------------
// Emoji Picker Popover System
// -------------------------------------------------------------
const POPULAR_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶',
  '😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧',
  '🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯',
  '😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩',
  '😫','🥱','😤','😡','😠','🤬','💀','💩','🤡','👹','👻','👽','🤖','🎃','😺','😸',
  '😹','😻','😼','😽','🙀','😿','😾','🤲','👐','🙌','👏','🤝','👍','👎','👊','✊',
  '🤛','🤜','🤞','✌️','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚',
  '🖐','🖖','👋','🤙','💪','🖕','✍️','🙏','👀','👅','👄','💋','💯','💢','💥','💫',
  '💦','💨','🔥','✨','🌟','⭐','🚀','⚡','💡','🎉','🥂','🏆','👑','💎','🎯','❤️',
  '🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘'
];

function setupEmojiPicker(triggerBtn, targetTextarea) {
  if (!triggerBtn || !targetTextarea) return;

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const existing = triggerBtn.parentElement.querySelector('.emoji-popover') ||
      triggerBtn.closest('.composer-toolbar')?.querySelector('.emoji-popover');
    
    document.querySelectorAll('.emoji-popover').forEach(p => p.remove());

    if (existing) return;

    const popover = document.createElement('div');
    popover.className = 'emoji-popover';
    popover.innerHTML = POPULAR_EMOJIS.map(em => `
      <button type="button" class="emoji-item-btn" data-emoji="${em}">${em}</button>
    `).join('');

    const container = triggerBtn.closest('.composer-toolbar') || triggerBtn.parentElement;
    container.appendChild(popover);

    popover.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.emoji-item-btn');
      if (!btn) return;
      ev.stopPropagation();
      const emoji = btn.dataset.emoji;

      const start = targetTextarea.selectionStart ?? targetTextarea.value.length;
      const end = targetTextarea.selectionEnd ?? targetTextarea.value.length;
      const text = targetTextarea.value;
      targetTextarea.value = text.substring(0, start) + emoji + text.substring(end);
      const newPos = start + emoji.length;
      targetTextarea.selectionStart = targetTextarea.selectionEnd = newPos;
      targetTextarea.focus();
      targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

// Wire emoji buttons
setupEmojiPicker(document.getElementById('mainComposerEmojiBtn'), document.getElementById('composerText'));
setupEmojiPicker(document.getElementById('modalComposeEmojiBtn'), document.getElementById('modalComposeText'));
setupEmojiPicker(document.getElementById('modalReplyEmojiBtn'), document.getElementById('modalReplyText'));
setupEmojiPicker(document.getElementById('quoteEmojiBtn'), document.getElementById('quoteCommentText'));
setupEmojiPicker(document.getElementById('detailEmojiBtn'), document.getElementById('detailReplyText'));

// -------------------------------------------------------------
// Main Composer Interactions
// -------------------------------------------------------------
const composerText = document.getElementById('composerText');
const charCounter = document.getElementById('charCounter');
const postBtn = document.getElementById('postBtn');

composerText.addEventListener('input', () => {
  composerText.style.height = 'auto';
  composerText.style.height = `${composerText.scrollHeight}px`;

  const remaining = 280 - composerText.value.length;
  charCounter.textContent = remaining;

  if (remaining < 0) {
    charCounter.className = 'char-counter limit-exceeded';
    postBtn.disabled = true;
  } else if (remaining <= 20) {
    charCounter.className = 'char-counter limit-near';
    postBtn.disabled = !composerText.value.trim();
  } else {
    charCounter.className = 'char-counter';
    postBtn.disabled = !composerText.value.trim();
  }
});

postBtn.addEventListener('click', async () => {
  const content = composerText.value.trim();
  if (!content) return;
  
  postBtn.disabled = true;
  try {
    await api('/tweets', {
      method: 'POST',
      body: { content },
    });
    composerText.value = '';
    composerText.style.height = 'auto';
    charCounter.textContent = '280';
    charCounter.className = 'char-counter';
    toast('Your post was sent');
    loadActiveFeed();
  } catch (err) {
    toast(err.message);
  } finally {
    postBtn.disabled = false;
  }
});

// -------------------------------------------------------------
// Bookmarks Helper
// -------------------------------------------------------------
async function refreshBookmarks() {
  try {
    const bookmarks = await api('/bookmarks');
    bookmarkedIds = new Set(bookmarks.map(b => b._id));
  } catch (_) {
    bookmarkedIds = new Set();
  }
}

// -------------------------------------------------------------
// Tweet Card Rendering (Handles Originals, Reposts & Quotes)
// -------------------------------------------------------------
function formatContentWithHashtags(text = '') {
  const escaped = escapeHtml(text);
  return escaped.replace(/#(\w+)/g, (match, tag) => {
    return `<a href="#" class="tweet-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`;
  });
}

function tweetCardTemplate(item) {
  let isRepost = false;
  let reposterName = '';
  let tweet = item;
  let isQuote = false;
  let quotedTweet = null;

  if (item.retweetOf) {
    if (item.content && item.content.trim()) {
      isQuote = true;
      quotedTweet = typeof item.retweetOf === 'object' && item.retweetOf !== null
        ? item.retweetOf
        : feedTweetMap.get(item.retweetOf) || activeTweetsCache.find(t => t._id === item.retweetOf);
      tweet = item;
    } else {
      isRepost = true;
      reposterName = item.author?.username || 'Someone';
      tweet = typeof item.retweetOf === 'object' && item.retweetOf !== null
        ? item.retweetOf
        : feedTweetMap.get(item.retweetOf) || activeTweetsCache.find(t => t._id === item.retweetOf) || item;
    }
  }

  const author = tweet.author || {};
  const authorName = author.username || 'unknown';
  const authorProfileUrl = `profile.html?user=${encodeURIComponent(authorName)}&id=${author._id || ''}`;
  
  const liked = (tweet.likes || []).some(id => id === me?._id || id?._id === me?._id);
  const bookmarked = bookmarkedIds.has(tweet._id);
  const retweetedByMe = myRetweetedIds.has(tweet._id);
  const likesCount = tweet.likesCount ?? (tweet.likes || []).length;
  const retweetsCount = tweet.retweetsCount ?? 0;
  const repliesCount = tweet.repliesCount ?? 0;

  const isMyRepost = (reposterName && me?.username && reposterName.toLowerCase() === me.username.toLowerCase());
  const repostText = isMyRepost
    ? `<span>You reposted</span>`
    : `<span><a href="profile.html?user=${encodeURIComponent(reposterName)}" class="author-link">${escapeHtml(reposterName)}</a> reposted</span>`;

  return `
    <article class="tweet-card" data-id="${tweet._id}" data-item-id="${item._id}">
      ${isRepost ? `
        <div class="tweet-repost-banner">
          <div class="repost-icon-col">
            ${ICONS.retweet}
          </div>
          <div class="repost-label">
            ${repostText}
          </div>
        </div>
      ` : ''}

      <div class="tweet-main-row">
        <div class="tweet-avatar-col">
          <a href="${authorProfileUrl}" class="author-link" title="@${escapeHtml(authorName)}">
            ${getAvatar(authorName, 'md')}
          </a>
        </div>
        <div class="tweet-body-col">
          <div class="tweet-meta-row">
            ${renderAuthorHeader(author, tweet.createdAt)}
            <div style="position:relative;">
              <button class="action-btn action-more-btn" data-action="more-options" data-id="${tweet._id}" data-item-id="${item._id}" title="More" type="button">
                ${ICONS.more}
              </button>
            </div>
          </div>

          <div class="tweet-text">${formatContentWithHashtags(tweet.content || '')}</div>

          ${isQuote && quotedTweet ? `
            <div class="tweet-quote-box" data-quote-id="${quotedTweet._id}">
              <div class="tweet-meta-row">
                ${renderAuthorHeader(quotedTweet.author, quotedTweet.createdAt)}
              </div>
              <div class="tweet-text">${formatContentWithHashtags(quotedTweet.content || '')}</div>
            </div>
          ` : ''}

          <div class="tweet-actions-bar">
            <!-- Reply -->
            <button class="action-btn action-reply" data-action="reply" title="Reply" type="button">
              <span class="action-icon-circle">${ICONS.reply}</span>
              <span>${repliesCount > 0 ? repliesCount : ''}</span>
            </button>

            <!-- Repost / Retweet with Popover Options -->
            <div style="position:relative; display:inline-flex;">
              <button class="action-btn action-retweet ${retweetedByMe ? 'active' : ''}" data-action="retweet-trigger" title="Repost" type="button">
                <span class="action-icon-circle">${ICONS.retweet}</span>
                <span>${retweetsCount > 0 ? retweetsCount : ''}</span>
              </button>
            </div>

            <!-- Like -->
            <button class="action-btn action-like ${liked ? 'active' : ''}" data-action="like" title="Like" type="button">
              <span class="action-icon-circle">${liked ? ICONS.heartFilled : ICONS.heart}</span>
              <span>${likesCount > 0 ? likesCount : ''}</span>
            </button>

            <!-- Bookmark -->
            <button class="action-btn action-bookmark ${bookmarked ? 'active' : ''}" data-action="bookmark" title="Bookmark" type="button">
              <span class="action-icon-circle">${bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</span>
            </button>

            <!-- Share -->
            <button class="action-btn action-share" data-action="share" title="Share" type="button">
              <span class="action-icon-circle">${ICONS.share}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  `;
}

// -------------------------------------------------------------
// Load Active Feed / Notifications
// -------------------------------------------------------------
async function loadActiveFeed() {
  const list = document.getElementById('feedList');
  list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Loading…</div></div>`;

  if (currentTab === 'notifications') {
    await loadNotificationsView();
    return;
  }

  try {
    await refreshBookmarks();
    let raw = [];

    if (currentTab === 'forYou') {
      raw = await api('/tweets');
    } else if (currentTab === 'following') {
      try {
        const res = await api('/feed');
        raw = Array.isArray(res) ? res : [];
      } catch (_) {
        raw = [];
      }
    } else if (currentTab === 'bookmarks') {
      const res = await api('/bookmarks');
      raw = Array.isArray(res) ? res : [];
    }

    // Filter out deleted tweets
    activeTweetsCache = (Array.isArray(raw) ? raw : [])
      .filter(t => t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id));

    // Pre-resolve quoted tweets so quote boxes always render
    await resolveQuotedTweets(activeTweetsCache);

    // Track which tweets have been retweeted by me
    myRetweetedIds = new Set();
    activeTweetsCache.forEach(t => {
      const isMyRetweet = (t.author?._id === me?._id || t.author === me?._id || t.author?.username === me?.username);
      if (isMyRetweet && t.retweetOf) {
        const targetId = typeof t.retweetOf === 'object' && t.retweetOf !== null ? t.retweetOf._id : t.retweetOf;
        if (targetId) myRetweetedIds.add(targetId);
      }
    });

    if (!activeTweetsCache.length) {
      if (currentTab === 'bookmarks') {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">Save posts for later</div>
            <div>Don’t let the good ones fly away! Bookmark posts to easily find them again in the future.</div>
          </div>`;
      } else if (currentTab === 'following') {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">Welcome to your timeline!</div>
            <div>When you follow people, their posts and reposts will show up here.</div>
          </div>`;
      } else {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">Welcome to 𝕏!</div>
            <div>This is the best place to see what’s happening in your world. Post something to start the conversation.</div>
          </div>`;
      }
      return;
    }

    list.innerHTML = activeTweetsCache.map(tweetCardTemplate).join('');
    
    // Also re-render "Who to follow" using actual active authors
    renderWhoToFollow();
  } catch (err) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Cannot load posts</div>
        <div>${escapeHtml(err.message)}</div>
      </div>`;
  }
}

// -------------------------------------------------------------
// Floating "New Posts" Pill Indicator
// -------------------------------------------------------------
function startNewPostsPolling() {
  if (newPostsPollingInterval) clearInterval(newPostsPollingInterval);
  newPostsPollingInterval = setInterval(async () => {
    if (currentTab !== 'forYou' || document.hidden) return;
    if (!activeTweetsCache.length) return;

    try {
      const fresh = await api('/tweets');
      if (!Array.isArray(fresh) || !fresh.length) return;

      const validFresh = fresh.filter(t => t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id));
      const currentTopId = activeTweetsCache[0]?._id;
      if (validFresh[0] && validFresh[0]._id !== currentTopId) {
        const topIndex = validFresh.findIndex(t => t._id === currentTopId);
        const newCount = topIndex > 0 ? topIndex : validFresh.filter(f => !activeTweetsCache.some(c => c._id === f._id)).length;
        
        if (newCount > 0) {
          const pill = document.getElementById('newPostsPill');
          pill.textContent = `↑ Show ${newCount} new ${newCount === 1 ? 'post' : 'posts'}`;
          pill.style.display = 'flex';
        }
      }
    } catch (_) {}
  }, 25000);
}

document.getElementById('newPostsPill').addEventListener('click', async () => {
  const pill = document.getElementById('newPostsPill');
  pill.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await loadActiveFeed();
});

startNewPostsPolling();

// -------------------------------------------------------------
// Notifications View (`GET /api/notifications` + mark-as-read)
// -------------------------------------------------------------
async function loadNotificationsView() {
  const list = document.getElementById('feedList');
  try {
    const notifications = await api('/notifications');

    api('/notifications/read', { method: 'PUT' }).catch(() => {
      api('/notifications/read', { method: 'POST' }).catch(() => {});
    });

    if (!notifications || !notifications.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Nothing to see here — yet</div>
          <div>From likes to reposts and a whole lot more, this is where all the action about your posts and your account will happen.</div>
        </div>`;
      return;
    }

    list.innerHTML = notifications.map(n => {
      const sender = n.sender || n.user || {};
      const senderName = sender.username || 'Someone';
      const senderUrl = `profile.html?user=${encodeURIComponent(senderName)}&id=${sender._id || ''}`;
      
      let icon = ICONS.bell;
      let actionText = 'interacted with your account';

      if (n.type === 'like') {
        icon = `<span style="color:var(--accent-pink)">${ICONS.heartFilled}</span>`;
        actionText = 'liked your post';
      } else if (n.type === 'retweet') {
        icon = `<span style="color:var(--accent-green)">${ICONS.retweet}</span>`;
        actionText = 'reposted your post';
      } else if (n.type === 'reply') {
        icon = `<span style="color:var(--accent-blue)">${ICONS.reply}</span>`;
        actionText = 'replied to your post';
      } else if (n.type === 'follow') {
        icon = `<span style="color:var(--accent-blue)">${ICONS.profile}</span>`;
        actionText = 'followed you';
      }

      return `
        <div class="notification-row ${!n.read ? 'unread' : ''}">
          <div class="notification-icon-col">${icon}</div>
          <div class="notification-content-col">
            <div class="notification-avatars">
              <a href="${senderUrl}" class="author-link">${getAvatar(senderName, 'sm')}</a>
            </div>
            <div class="notification-text">
              <a href="${senderUrl}" class="author-link" style="font-weight:700;">${escapeHtml(senderName)}</a>
              ${escapeHtml(actionText)}
            </div>
            ${n.tweet?.content ? `<div class="notification-subtext">${escapeHtml(n.tweet.content)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Notifications unavailable</div>
        <div>${escapeHtml(err.message)}</div>
      </div>`;
  }
}

// -------------------------------------------------------------
// Stream Event Delegation (Actions, More Options, Thread Detail)
// -------------------------------------------------------------
document.getElementById('feedList').addEventListener('click', async (e) => {
  const tagEl = e.target.closest('[data-tag]');
  if (tagEl) {
    e.preventDefault();
    e.stopPropagation();
    filterByTag(tagEl.dataset.tag);
    return;
  }

  // Quoted tweet box click: open the quoted tweet in detail
  const quoteBox = e.target.closest('.tweet-quote-box');
  if (quoteBox && !e.target.closest('.action-btn')) {
    e.stopPropagation();
    const qid = quoteBox.dataset.quoteId;
    if (qid) {
      const qTweet = feedTweetMap.get(qid) || activeTweetsCache.find(t => t._id === qid);
      if (qTweet) {
        openTweetDetailModal(qTweet);
      } else {
        api(`/tweets/${qid}`, { auth: false }).then(openTweetDetailModal).catch(() => toast('Viewing quoted post'));
      }
    }
    return;
  }

  // Repost Popover Action
  const popoverItem = e.target.closest('.repost-popover-item');
  if (popoverItem) {
    e.stopPropagation();
    const action = popoverItem.dataset.repostAction;
    const tweetId = popoverItem.dataset.tweetId;
    const tweet = activeTweetsCache.find(t => t._id === tweetId) || feedTweetMap.get(tweetId) || { _id: tweetId };
    document.querySelectorAll('.repost-popover').forEach(p => p.remove());

    if (action === 'repost') {
      try {
        const res = await api(`/tweets/${tweetId}/retweet`, { method: 'POST' });
        toast(res && res.msg === 'Retweet removed.' ? 'Undo repost' : 'Reposted');
        loadActiveFeed();
      } catch (err) {
        toast(err.message);
      }
    } else if (action === 'quote') {
      openQuoteModal(tweet);
    }
    return;
  }

  // Tweet Options Popover Action (`···` more menu item)
  const optionItem = e.target.closest('.tweet-option-item');
  if (optionItem) {
    e.stopPropagation();
    const option = optionItem.dataset.option;
    const tweetId = optionItem.dataset.id;
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());

    if (option === 'delete') {
      pendingDeleteTweetId = tweetId;
      document.getElementById('deletePostModal').classList.add('open');
    } else if (option === 'copy-link') {
      const url = `${window.location.origin}/profile.html?id=${tweetId}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast('Copied link to clipboard');
      } else {
        toast('Link copied');
      }
    }
    return;
  }

  // More Options Button (`···`)
  const moreBtn = e.target.closest('[data-action="more-options"]');
  if (moreBtn) {
    e.stopPropagation();
    const tweetId = moreBtn.dataset.id;
    const itemId = moreBtn.dataset.itemId || tweetId;
    const item = activeTweetsCache.find(t => t._id === itemId) || feedTweetMap.get(itemId);
    const tweet = activeTweetsCache.find(t => t._id === tweetId) || feedTweetMap.get(tweetId) || { _id: tweetId };
    
    // Check if author is me (either original author or reposter)
    const isMyPost = (tweet.author?._id === me?._id || tweet.author === me?._id || tweet.author?.username === me?.username);
    const isMyItem = item && (item.author?._id === me?._id || item.author === me?._id || item.author?.username === me?.username);
    const canDelete = isMyItem || isMyPost;
    const deleteTargetId = isMyItem ? itemId : tweetId;

    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());
    const popover = document.createElement('div');
    popover.className = 'tweet-options-popover';
    popover.innerHTML = `
      ${canDelete ? `
        <button class="tweet-option-item danger" data-option="delete" data-id="${deleteTargetId}">
          ${ICONS.trash}
          <span>${isMyItem && itemId !== tweetId ? 'Undo repost' : 'Delete post'}</span>
        </button>
      ` : ''}
      <button class="tweet-option-item" data-option="copy-link" data-id="${tweetId}">
        ${ICONS.share}
        <span>Copy link to post</span>
      </button>
    `;
    moreBtn.parentElement.appendChild(popover);
    return;
  }

  // Action Buttons (Reply, Retweet trigger, Like, Bookmark, Share)
  const btn = e.target.closest('.action-btn');
  if (btn) {
    e.stopPropagation();
    const article = e.target.closest('.tweet-card');
    if (!article) return;
    const id = article.dataset.id;
    const action = btn.dataset.action;
    const tweet = activeTweetsCache.find(t => t._id === id) || feedTweetMap.get(id) || { _id: id };

    try {
      if (action === 'like') {
        await api(`/tweets/${id}/like`, { method: 'POST' });
        await loadActiveFeed();
      } else if (action === 'retweet-trigger') {
        document.querySelectorAll('.repost-popover').forEach(p => p.remove());
        const popover = document.createElement('div');
        popover.className = 'repost-popover';
        popover.innerHTML = `
          <button class="repost-popover-item" data-repost-action="repost" data-tweet-id="${id}">
            ${ICONS.retweet} Repost
          </button>
          <button class="repost-popover-item" data-repost-action="quote" data-tweet-id="${id}">
            ${ICONS.quote} Quote
          </button>
        `;
        btn.parentElement.appendChild(popover);
      } else if (action === 'bookmark') {
        await api(`/bookmarks/${id}/bookmark`, { method: 'POST' });
        const wasBookmarked = bookmarkedIds.has(id);
        toast(wasBookmarked ? 'Removed from your Bookmarks' : 'Added to your Bookmarks');
        await loadActiveFeed();
      } else if (action === 'reply') {
        openReplyModal(tweet);
      } else if (action === 'share') {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(window.location.origin + `/profile.html?id=${id}`);
          toast('Copied link to clipboard');
        } else {
          toast('Link copied');
        }
      }
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  // Ignore clicks on links/buttons
  if (e.target.closest('a') || e.target.closest('button')) return;

  // Clicking on tweet card opens Thread / Detail View
  const card = e.target.closest('.tweet-card');
  if (card) {
    const id = card.dataset.id;
    let tweet = activeTweetsCache.find(t => t._id === id) || feedTweetMap.get(id);
    if (!tweet && id) {
      try {
        tweet = await api(`/tweets/${id}`);
        if (tweet) feedTweetMap.set(tweet._id, tweet);
      } catch (_) {}
    }
    if (tweet) {
      openTweetDetailModal(tweet);
    }
  }
});

// -------------------------------------------------------------
// 𝕏 Delete Post Modal Wiring
// -------------------------------------------------------------
const deletePostModal = document.getElementById('deletePostModal');
const btnConfirmDeletePost = document.getElementById('btnConfirmDeletePost');
const btnCancelDeletePost = document.getElementById('btnCancelDeletePost');

btnCancelDeletePost.addEventListener('click', () => {
  deletePostModal.classList.remove('open');
  pendingDeleteTweetId = null;
});

deletePostModal.addEventListener('click', (e) => {
  if (e.target === deletePostModal) {
    deletePostModal.classList.remove('open');
    pendingDeleteTweetId = null;
  }
});

btnConfirmDeletePost.addEventListener('click', async () => {
  if (!pendingDeleteTweetId) return;

  btnConfirmDeletePost.disabled = true;
  btnConfirmDeletePost.textContent = 'Deleting…';

  try {
    await api(`/tweets/${pendingDeleteTweetId}`, { method: 'DELETE' });
    deletePostModal.classList.remove('open');
    toast('Your post was deleted');

    // Add to persistent deleted set
    locallyDeletedTweetIds.add(pendingDeleteTweetId);
    localStorage.setItem('deleted_tweet_ids', JSON.stringify([...locallyDeletedTweetIds]));

    // Close detail modal if the deleted post is currently opened in it
    if (activeDetailTweet && activeDetailTweet._id === pendingDeleteTweetId) {
      closeDetailModal();
    }

    // Remove from cache and DOM
    activeTweetsCache = activeTweetsCache.filter(t => t._id !== pendingDeleteTweetId && t.retweetOf !== pendingDeleteTweetId);
    document.querySelectorAll(`[data-id="${pendingDeleteTweetId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`[data-item-id="${pendingDeleteTweetId}"]`).forEach(el => el.remove());
    
    // Refresh timeline
    loadActiveFeed();
  } catch (err) {
    toast(err.message);
  } finally {
    btnConfirmDeletePost.disabled = false;
    btnConfirmDeletePost.textContent = 'Delete';
    pendingDeleteTweetId = null;
  }
});

// -------------------------------------------------------------
// 𝕏 Single Tweet Conversation & Detail Thread Modal
// -------------------------------------------------------------
const tweetDetailModal = document.getElementById('tweetDetailModal');
const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
const detailMainTweetContainer = document.getElementById('detailMainTweetContainer');
const detailRepliesContainer = document.getElementById('detailRepliesContainer');
const detailReplyText = document.getElementById('detailReplyText');
const detailCharCounter = document.getElementById('detailCharCounter');
const detailReplyBtn = document.getElementById('detailReplyBtn');

function openTweetDetailModal(tweet) {
  activeDetailTweet = tweet;
  const author = tweet.author || {};
  const authorName = author.username || 'unknown';

  const liked = (tweet.likes || []).some(id => id === me?._id || id?._id === me?._id);
  const bookmarked = bookmarkedIds.has(tweet._id);
  const retweetedByMe = myRetweetedIds.has(tweet._id);
  const likesCount = tweet.likesCount ?? (tweet.likes || []).length;
  const retweetsCount = tweet.retweetsCount ?? 0;
  const repliesCount = tweet.repliesCount ?? 0;

  // Resolve quoted tweet if any
  let quotedTweet = null;
  if (tweet.retweetOf) {
    quotedTweet = typeof tweet.retweetOf === 'object' && tweet.retweetOf !== null
      ? tweet.retweetOf
      : feedTweetMap.get(tweet.retweetOf) || activeTweetsCache.find(t => t._id === tweet.retweetOf);
  }

  // Render main tweet
  detailMainTweetContainer.innerHTML = `
    <div class="tweet-detail-author-row">
      <div class="tweet-detail-author-left">
        <a href="profile.html?user=${encodeURIComponent(authorName)}&id=${author._id || ''}" class="author-link">${getAvatar(authorName, 'md')}</a>
        ${renderAuthorHeader(author, tweet.createdAt)}
      </div>
      <div style="position:relative;">
        <button class="action-btn action-more-btn" data-action="more-options" data-id="${tweet._id}" title="More" type="button">
          ${ICONS.more}
        </button>
      </div>
    </div>

    <div class="tweet-detail-text">${formatContentWithHashtags(tweet.content || '')}</div>

    ${quotedTweet ? `
      <div class="tweet-quote-box" data-quote-id="${quotedTweet._id}" style="margin-bottom:14px;">
        <div class="tweet-meta-row">
          ${renderAuthorHeader(quotedTweet.author, quotedTweet.createdAt)}
        </div>
        <div class="tweet-text">${formatContentWithHashtags(quotedTweet.content || '')}</div>
      </div>
    ` : ''}

    <div class="tweet-detail-date">${formatFullTimestamp(tweet.createdAt)}</div>

    <div class="tweet-detail-metrics">
      <span><span class="stat-num" id="detailRepliesMetric">${repliesCount}</span> Replies</span>
      <span><span class="stat-num" id="detailRetweetsMetric">${retweetsCount}</span> Reposts</span>
      <span><span class="stat-num" id="detailLikesMetric">${likesCount}</span> Likes</span>
    </div>

    <div class="tweet-detail-actions">
      <button class="action-btn action-reply" id="detailActionReply" title="Reply" type="button">
        <span class="action-icon-circle">${ICONS.reply}</span>
      </button>
      <button class="action-btn action-retweet ${retweetedByMe ? 'active' : ''}" id="detailActionRetweet" title="Repost" type="button">
        <span class="action-icon-circle">${ICONS.retweet}</span>
      </button>
      <button class="action-btn action-like ${liked ? 'active' : ''}" id="detailActionLike" title="Like" type="button">
        <span class="action-icon-circle">${liked ? ICONS.heartFilled : ICONS.heart}</span>
      </button>
      <button class="action-btn action-bookmark ${bookmarked ? 'active' : ''}" id="detailActionBookmark" title="Bookmark" type="button">
        <span class="action-icon-circle">${bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</span>
      </button>
      <button class="action-btn action-share" id="detailActionShare" title="Share" type="button">
        <span class="action-icon-circle">${ICONS.share}</span>
      </button>
    </div>
  `;

  // Wire detail action buttons
  document.getElementById('detailActionReply').addEventListener('click', () => {
    detailReplyText.focus();
  });

  document.getElementById('detailActionLike').addEventListener('click', async () => {
    try {
      await api(`/tweets/${tweet._id}/like`, { method: 'POST' });
      toast('Updated like');
      loadActiveFeed();
      const isNowLiked = !(tweet.likes || []).some(id => id === me?._id || id?._id === me?._id);
      document.getElementById('detailActionLike').classList.toggle('active', isNowLiked);
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('detailActionRetweet').addEventListener('click', async () => {
    try {
      await api(`/tweets/${tweet._id}/retweet`, { method: 'POST' });
      toast('Reposted');
      loadActiveFeed();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('detailActionBookmark').addEventListener('click', async () => {
    try {
      await api(`/bookmarks/${tweet._id}/bookmark`, { method: 'POST' });
      const wasBm = bookmarkedIds.has(tweet._id);
      toast(wasBm ? 'Removed from Bookmarks' : 'Added to Bookmarks');
      loadActiveFeed();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('detailActionShare').addEventListener('click', async () => {
    const url = `${window.location.origin}/profile.html?id=${tweet._id}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast('Copied link to clipboard');
    } else {
      toast('Link copied');
    }
  });

  // Reset composer
  detailReplyText.value = '';
  detailReplyText.style.height = 'auto';
  detailCharCounter.textContent = '280';
  detailCharCounter.className = 'char-counter';
  detailReplyBtn.disabled = true;

  // Render replies stream
  renderDetailReplies(tweet._id);

  tweetDetailModal.classList.add('open');
}

function renderDetailReplies(tweetId) {
  const replies = activeTweetsCache.filter(t => 
    (t.retweetOf === tweetId || t.retweetOf?._id === tweetId) && t.content && t.content.trim()
  );

  if (!replies.length) {
    detailRepliesContainer.innerHTML = `
      <div class="empty-state" style="padding:28px 16px;">
        <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">No replies yet</div>
        <div>Be the first to reply!</div>
      </div>
    `;
    return;
  }

  detailRepliesContainer.innerHTML = replies.map(r => {
    const rAuthor = r.author || {};
    const rAuthorName = rAuthor.username || 'user';
    const rProfileUrl = `profile.html?user=${encodeURIComponent(rAuthorName)}&id=${rAuthor._id || ''}`;
    
    return `
      <article class="tweet-card" data-id="${r._id}">
        <div style="display:flex; gap:12px; width:100%;">
          <div class="tweet-avatar-col">
            <a href="${rProfileUrl}" class="author-link">${getAvatar(rAuthorName, 'md')}</a>
          </div>
          <div class="tweet-body-col">
            <div class="tweet-meta-row">
              ${renderAuthorHeader(rAuthor, r.createdAt)}
            </div>
            <div class="tweet-text">${formatContentWithHashtags(r.content || '')}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function closeDetailModal() {
  tweetDetailModal.classList.remove('open');
  activeDetailTweet = null;
}

closeDetailModalBtn.addEventListener('click', closeDetailModal);
tweetDetailModal.addEventListener('click', (e) => {
  if (e.target === tweetDetailModal) closeDetailModal();
});

// Inline reply inside detail modal
detailReplyText.addEventListener('input', () => {
  detailReplyText.style.height = 'auto';
  detailReplyText.style.height = `${detailReplyText.scrollHeight}px`;

  const remaining = 280 - detailReplyText.value.length;
  detailCharCounter.textContent = remaining;

  if (remaining < 0) {
    detailCharCounter.className = 'char-counter limit-exceeded';
    detailReplyBtn.disabled = true;
  } else if (remaining <= 20) {
    detailCharCounter.className = 'char-counter limit-near';
    detailReplyBtn.disabled = !detailReplyText.value.trim();
  } else {
    detailCharCounter.className = 'char-counter';
    detailReplyBtn.disabled = !detailReplyText.value.trim();
  }
});

detailReplyBtn.addEventListener('click', async () => {
  if (!activeDetailTweet) return;
  const content = detailReplyText.value.trim();
  if (!content) return;

  detailReplyBtn.disabled = true;
  try {
    const newReply = await api(`/tweets/${activeDetailTweet._id}/reply`, {
      method: 'POST',
      body: { content },
    });

    toast('Your reply was sent');
    detailReplyText.value = '';
    detailReplyText.style.height = 'auto';
    detailCharCounter.textContent = '280';
    detailReplyBtn.disabled = true;

    if (newReply) {
      activeTweetsCache.unshift(newReply);
      renderDetailReplies(activeDetailTweet._id);
      
      const countEl = document.getElementById('detailRepliesMetric');
      if (countEl) {
        countEl.textContent = (parseInt(countEl.textContent || '0', 10) + 1);
      }
    }
    loadActiveFeed();
  } catch (err) {
    toast(err.message);
  } finally {
    detailReplyBtn.disabled = false;
  }
});

// -------------------------------------------------------------
// 𝕏 Reply Modal Implementation (From stream reply icon)
// -------------------------------------------------------------
const replyModal = document.getElementById('replyModal');
const closeReplyModalBtn = document.getElementById('closeReplyModalBtn');
const modalReplyText = document.getElementById('modalReplyText');
const modalCharCounter = document.getElementById('modalCharCounter');
const modalReplyBtn = document.getElementById('modalReplyBtn');

function openReplyModal(tweet) {
  activeReplyTweet = tweet;
  const author = tweet.author || {};
  const authorName = author.username || 'unknown';

  document.getElementById('modalParentAvatar').innerHTML = getAvatar(authorName, 'md');
  document.getElementById('modalParentName').textContent = author.name || `@${authorName}`;
  document.getElementById('modalParentHandle').textContent = `@${authorName}`;
  document.getElementById('modalParentTime').textContent = timeAgo(tweet.createdAt);
  document.getElementById('modalParentText').textContent = tweet.content || '';
  document.getElementById('modalReplyingToHandle').textContent = `@${authorName}`;

  modalReplyText.value = '';
  modalReplyText.style.height = 'auto';
  modalCharCounter.textContent = '280';
  modalCharCounter.className = 'char-counter';
  modalReplyBtn.disabled = true;

  replyModal.classList.add('open');
  modalReplyText.focus();
}

function closeReplyModal() {
  replyModal.classList.remove('open');
  activeReplyTweet = null;
}

closeReplyModalBtn.addEventListener('click', closeReplyModal);
replyModal.addEventListener('click', (e) => {
  if (e.target === replyModal) closeReplyModal();
});

modalReplyText.addEventListener('input', () => {
  modalReplyText.style.height = 'auto';
  modalReplyText.style.height = `${modalReplyText.scrollHeight}px`;

  const remaining = 280 - modalReplyText.value.length;
  modalCharCounter.textContent = remaining;

  if (remaining < 0) {
    modalCharCounter.className = 'char-counter limit-exceeded';
    modalReplyBtn.disabled = true;
  } else if (remaining <= 20) {
    modalCharCounter.className = 'char-counter limit-near';
    modalReplyBtn.disabled = !modalReplyText.value.trim();
  } else {
    modalCharCounter.className = 'char-counter';
    modalReplyBtn.disabled = !modalReplyText.value.trim();
  }
});

modalReplyBtn.addEventListener('click', async () => {
  if (!activeReplyTweet) return;
  const content = modalReplyText.value.trim();
  if (!content) return;

  modalReplyBtn.disabled = true;
  try {
    await api(`/tweets/${activeReplyTweet._id}/reply`, {
      method: 'POST',
      body: { content },
    });
    closeReplyModal();
    toast('Your reply was sent');
    loadActiveFeed();
  } catch (err) {
    toast(err.message);
  } finally {
    modalReplyBtn.disabled = false;
  }
});

// -------------------------------------------------------------
// 𝕏 Quote Tweet Modal (`POST /api/tweets/:id/quote`)
// -------------------------------------------------------------
const quoteModal = document.getElementById('quoteModal');
const closeQuoteModalBtn = document.getElementById('closeQuoteModalBtn');
const quoteCommentText = document.getElementById('quoteCommentText');
const quoteCharCounter = document.getElementById('quoteCharCounter');
const quoteSubmitBtn = document.getElementById('quoteSubmitBtn');

function openQuoteModal(tweet) {
  activeQuoteTweet = tweet;
  const author = tweet.author || {};
  const authorName = author.username || 'unknown';

  document.getElementById('quoteParentName').textContent = author.name || `@${authorName}`;
  document.getElementById('quoteParentHandle').textContent = `@${authorName}`;
  document.getElementById('quoteParentTime').textContent = timeAgo(tweet.createdAt);
  document.getElementById('quoteParentText').textContent = tweet.content || '';

  quoteCommentText.value = '';
  quoteCommentText.style.height = 'auto';
  quoteCharCounter.textContent = '280';
  quoteCharCounter.className = 'char-counter';
  quoteSubmitBtn.disabled = true;

  quoteModal.classList.add('open');
  quoteCommentText.focus();
}

function closeQuoteModal() {
  quoteModal.classList.remove('open');
  activeQuoteTweet = null;
}

closeQuoteModalBtn.addEventListener('click', closeQuoteModal);
quoteModal.addEventListener('click', (e) => {
  if (e.target === quoteModal) closeQuoteModal();
});

quoteCommentText.addEventListener('input', () => {
  quoteCommentText.style.height = 'auto';
  quoteCommentText.style.height = `${quoteCommentText.scrollHeight}px`;

  const remaining = 280 - quoteCommentText.value.length;
  quoteCharCounter.textContent = remaining;

  if (remaining < 0) {
    quoteCharCounter.className = 'char-counter limit-exceeded';
    quoteSubmitBtn.disabled = true;
  } else {
    quoteCharCounter.className = remaining <= 20 ? 'char-counter limit-near' : 'char-counter';
    quoteSubmitBtn.disabled = !quoteCommentText.value.trim();
  }
});

quoteSubmitBtn.addEventListener('click', async () => {
  if (!activeQuoteTweet) return;
  const content = quoteCommentText.value.trim();
  if (!content) return;

  quoteSubmitBtn.disabled = true;
  try {
    await api(`/tweets/${activeQuoteTweet._id}/quote`, {
      method: 'POST',
      body: { content },
    });
    closeQuoteModal();
    toast('Your quote was posted');
    loadActiveFeed();
  } catch (err) {
    toast(err.message);
  } finally {
    quoteSubmitBtn.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (replyModal.classList.contains('open')) closeReplyModal();
    if (quoteModal.classList.contains('open')) closeQuoteModal();
    if (tweetDetailModal.classList.contains('open')) closeDetailModal();
    if (composeModal && composeModal.classList.contains('open')) closeComposeModal();
    if (deletePostModal.classList.contains('open')) {
      deletePostModal.classList.remove('open');
      pendingDeleteTweetId = null;
    }
    document.querySelectorAll('.emoji-popover').forEach(p => p.remove());
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());
    document.querySelectorAll('.repost-popover').forEach(p => p.remove());
  }
});

// -------------------------------------------------------------
// Search Functionality & Click-to-Detail
// -------------------------------------------------------------
const searchInput = document.getElementById('searchInput');
const searchCard = document.getElementById('searchCard');
const searchResults = document.getElementById('searchResults');
let searchDebounceTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(performSearch, 350);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchDebounceTimer);
    performSearch();
  }
});

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchCard.style.display = 'none';
    searchResults.innerHTML = '';
    return;
  }

  searchCard.style.display = 'block';
  searchResults.innerHTML = `<div class="empty-state" style="padding:16px;">Searching…</div>`;

  try {
    const data = await api(`/search?q=${encodeURIComponent(query)}`, { auth: false });
    const users = data.users || [];
    const tweets = data.tweets || [];
    lastSearchTweets = tweets.filter(t => t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id));

    if (!users.length && !lastSearchTweets.length) {
      searchResults.innerHTML = `<div class="empty-state" style="padding:16px;">No results for "${escapeHtml(query)}"</div>`;
      return;
    }

    let html = '';
    if (users.length) {
      html += users.map(u => {
        const isFollowed = isUserFollowed(u._id, u.username);
        const displayName = u.name || `@${u.username}`;
        return `
          <div class="user-suggest-row">
            <div class="user-suggest-left">
              <a href="profile.html?user=${encodeURIComponent(u.username)}&id=${u._id}" class="author-link">
                ${getAvatar(u.username, 'md')}
              </a>
              <div class="user-suggest-names">
                <a href="profile.html?user=${encodeURIComponent(u.username)}&id=${u._id}" class="author-link tweet-author-name">${escapeHtml(displayName)}</a>
                <div class="tweet-author-handle">@${escapeHtml(u.username)}</div>
              </div>
            </div>
            <button class="btn-follow ${isFollowed ? 'following' : ''}" data-follow-id="${u._id}" data-username="${escapeHtml(u.username)}">
              ${isFollowed ? 'Following' : 'Follow'}
            </button>
          </div>
        `;
      }).join('');
    }

    if (lastSearchTweets.length) {
      html += lastSearchTweets.map(t => `
        <div class="trend-row search-tweet-result" data-tweet-id="${t._id}" style="border-top:1px solid var(--border-color); cursor:pointer;">
          <div class="trend-meta">Matching post · @${escapeHtml(t.author?.username || 'user')}</div>
          <div class="trend-name" style="font-weight:400; font-size:14px; margin-top:4px;">${escapeHtml(t.content || '')}</div>
        </div>
      `).join('');
    }

    searchResults.innerHTML = html;
  } catch (err) {
    searchResults.innerHTML = `<div class="empty-state" style="padding:16px;">${escapeHtml(err.message)}</div>`;
  }
}

// Search result click delegation: Follow user OR open Tweet detail
document.getElementById('searchResults').addEventListener('click', async (e) => {
  // Follow toggle inside search results
  const followBtn = e.target.closest('[data-follow-id]');
  if (followBtn) {
    e.stopPropagation();
    const id = followBtn.dataset.followId;
    const username = followBtn.dataset.username;

    try {
      const res = await api(`/users/${id}/follow`, { method: 'POST' });
      const isFollowing = !!res.following;
      followBtn.textContent = isFollowing ? 'Following' : 'Follow';
      followBtn.classList.toggle('following', isFollowing);
      setUserFollowed(id, username, isFollowing);
      toast(isFollowing ? `Following @${username}` : `Unfollowed @${username}`);
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  // Click on search tweet result opens thread/detail view
  const searchTweet = e.target.closest('.search-tweet-result');
  if (searchTweet) {
    const tweetId = searchTweet.dataset.tweetId;
    const tweet = lastSearchTweets.find(t => t._id === tweetId);
    if (tweet) {
      openTweetDetailModal(tweet);
    } else {
      api(`/tweets/${tweetId}`, { auth: false })
        .then(openTweetDetailModal)
        .catch(() => toast('Could not load post'));
    }
  }
});

// -------------------------------------------------------------
// Trending Hashtags
// -------------------------------------------------------------
async function loadTrending() {
  const box = document.getElementById('trendingList');
  try {
    const tags = await api('/trending', { auth: false });
    if (!tags || !tags.length) {
      box.innerHTML = `<div class="empty-state" style="padding:16px;">No trends right now</div>`;
      return;
    }

    box.innerHTML = tags.slice(0, 5).map(t => `
      <div class="trend-row" data-trend-tag="${escapeHtml(t._id)}">
        <div class="trend-meta">Trending · Technology</div>
        <div class="trend-name">#${escapeHtml(t._id)}</div>
        <div class="trend-volume">${t.count ?? 1} posts</div>
      </div>
    `).join('');
  } catch (_) {
    box.innerHTML = `
      <div class="trend-row" data-trend-tag="JavaScript">
        <div class="trend-meta">Trending in Tech</div>
        <div class="trend-name">#JavaScript</div>
        <div class="trend-volume">24.5K posts</div>
      </div>
      <div class="trend-row" data-trend-tag="WebDev">
        <div class="trend-meta">Trending in Software</div>
        <div class="trend-name">#WebDev</div>
        <div class="trend-volume">12.1K posts</div>
      </div>
      <div class="trend-row" data-trend-tag="OpenSource">
        <div class="trend-meta">Trending</div>
        <div class="trend-name">#OpenSource</div>
        <div class="trend-volume">8.9K posts</div>
      </div>
    `;
  }
}

document.getElementById('trendingList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-trend-tag]');
  if (!row) return;
  filterByTag(row.dataset.trendTag);
});

async function filterByTag(tag) {
  document.getElementById('timelineTitle').textContent = `#${tag}`;
  const list = document.getElementById('feedList');
  list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Loading #${escapeHtml(tag)}…</div></div>`;

  try {
    const tweets = await api(`/hashtags/${encodeURIComponent(tag)}`, { auth: false });
    activeTweetsCache = (tweets || []).filter(t => t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id));
    if (!activeTweetsCache.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No results for #${escapeHtml(tag)}</div>
          <div>Try searching for something else or check what's trending.</div>
        </div>`;
      return;
    }
    await resolveQuotedTweets(activeTweetsCache);
    list.innerHTML = activeTweetsCache.map(tweetCardTemplate).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error</div><div>${escapeHtml(err.message)}</div></div>`;
  }
}

// -------------------------------------------------------------
// Real Suggested Accounts ("Who to follow")
// -------------------------------------------------------------
async function renderWhoToFollow() {
  const container = document.getElementById('whoToFollowList');
  const seenUsernames = new Set();
  if (me?.username) seenUsernames.add(me.username.toLowerCase());

  const realUsers = [];

  // 1. Gather authors from current feed
  activeTweetsCache.forEach(t => {
    const a = t.author;
    if (a && typeof a === 'object' && a.username && !seenUsernames.has(a.username.toLowerCase())) {
      seenUsernames.add(a.username.toLowerCase());
      realUsers.push(a);
    }
  });

  // 2. Fetch active users via general search query to discover registered users
  if (realUsers.length < 3) {
    try {
      const searchRes = await api('/search?q=a', { auth: false });
      (searchRes.users || []).forEach(u => {
        if (u && u.username && !seenUsernames.has(u.username.toLowerCase())) {
          seenUsernames.add(u.username.toLowerCase());
          realUsers.push(u);
        }
      });
    } catch (_) {}
  }

  if (!realUsers.length) {
    container.innerHTML = `<div class="empty-state" style="padding:16px;">No suggestions right now</div>`;
    return;
  }

  const suggestions = realUsers.slice(0, 3);

  container.innerHTML = suggestions.map(s => {
    const isFollowed = isUserFollowed(s._id, s.username);
    const displayName = s.name || `@${s.username}`;
    return `
      <div class="user-suggest-row">
        <div class="user-suggest-left">
          <a href="profile.html?user=${encodeURIComponent(s.username)}&id=${s._id || ''}" class="author-link">
            ${getAvatar(s.username, 'md')}
          </a>
          <div class="user-suggest-names">
            <a href="profile.html?user=${encodeURIComponent(s.username)}&id=${s._id || ''}" class="author-link tweet-author-name">${escapeHtml(displayName)}</a>
            <div class="tweet-author-handle">@${escapeHtml(s.username)}</div>
          </div>
        </div>
        <button class="btn-follow ${isFollowed ? 'following' : ''}" data-follow-id="${s._id || ''}" data-username="${escapeHtml(s.username)}">
          ${isFollowed ? 'Following' : 'Follow'}
        </button>
      </div>
    `;
  }).join('');
}

// Follow toggle inside Who to follow
document.getElementById('whoToFollowList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-follow-id]');
  if (!btn) return;
  const id = btn.dataset.followId;
  const username = btn.dataset.username;

  try {
    const res = await api(`/users/${id}/follow`, { method: 'POST' });
    const isFollowing = !!res.following;
    btn.textContent = isFollowing ? 'Following' : 'Follow';
    btn.classList.toggle('following', isFollowing);
    setUserFollowed(id, username, isFollowing);
    toast(isFollowing ? `Following @${username}` : `Unfollowed @${username}`);
  } catch (err) {
    toast(err.message);
  }
});

// Initial boot
loadActiveFeed();
loadTrending();
renderWhoToFollow();
