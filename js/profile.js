requireAuth();

const me = getUser();
const urlParams = new URLSearchParams(window.location.search);
const targetUsername = urlParams.get('user');
const targetId = urlParams.get('id');
const isSelf = !targetUsername || targetUsername === me?.username;

let currentProfilePosts = [];
let pendingDeleteTweetId = null;
let activeDetailTweet = null;
let activeReplyTweet = null;
let activeQuoteTweet = null;

// Persistent tracking of deleted tweet IDs across pages & tabs
const locallyDeletedTweetIds = new Set(JSON.parse(localStorage.getItem('deleted_tweet_ids') || '[]'));

// -------------------------------------------------------------
// Left Sidebar Menu & Account Dropdown
// -------------------------------------------------------------
function initSidebarUI(username) {
  document.getElementById('sidebarName').textContent = username;
  document.getElementById('sidebarHandle').textContent = `@${username}`;
  document.getElementById('dropdownHandle').textContent = `@${username}`;
  document.getElementById('sidebarAvatar').innerHTML = getAvatar(username, 'md');

  const detailAvatarEl = document.getElementById('detailMyAvatar');
  if (detailAvatarEl) detailAvatarEl.innerHTML = getAvatar(username, 'md');
  const modalMyAvatar = document.getElementById('modalMyAvatar');
  if (modalMyAvatar) modalMyAvatar.innerHTML = getAvatar(username, 'md');
  const quoteMyAvatar = document.getElementById('quoteMyAvatar');
  if (quoteMyAvatar) quoteMyAvatar.innerHTML = getAvatar(username, 'md');
  const composeAvatarEl = document.getElementById('modalComposeAvatar');
  if (composeAvatarEl) composeAvatarEl.innerHTML = getAvatar(username, 'md');
}

initSidebarUI(me?.username || 'user');

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
  if (!e.target.closest('.tweet-options-popover') && !e.target.closest('[data-action="more-options"]')) {
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());
  }
  if (!e.target.closest('.repost-popover') && !e.target.closest('[data-action="retweet"]')) {
    document.querySelectorAll('.repost-popover').forEach(p => p.remove());
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

const btnSidebarPost = document.getElementById('btnSidebarPost');
if (btnSidebarPost) {
  btnSidebarPost.addEventListener('click', (e) => {
    e.preventDefault();
    openComposeModal();
  });
}

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
      loadProfile();
    } catch (err) {
      toast(err.message);
    } finally {
      modalComposeSubmitBtn.disabled = false;
    }
  });
}

// -------------------------------------------------------------
// Emoji Picker System
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

setupEmojiPicker(document.getElementById('modalComposeEmojiBtn'), document.getElementById('modalComposeText'));
setupEmojiPicker(document.getElementById('detailEmojiBtn'), document.getElementById('detailReplyText'));
setupEmojiPicker(document.getElementById('modalReplyEmojiBtn'), document.getElementById('modalReplyText'));
setupEmojiPicker(document.getElementById('quoteEmojiBtn'), document.getElementById('quoteCommentText'));

// -------------------------------------------------------------
// Author Header Formatter (Prevents awkward "test @test · 33m")
// -------------------------------------------------------------
function renderAuthorHeader(author, createdAt, fallbackUsername) {
  const username = author?.username || fallbackUsername || 'user';
  const name = (author?.name || '').trim();
  const authorProfileUrl = `profile.html?user=${encodeURIComponent(username)}&id=${author?._id || ''}`;

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

  return `
    <div class="tweet-author-info">
      <a href="${authorProfileUrl}" class="author-link tweet-author-name">@${escapeHtml(username)}</a>
      <span class="tweet-dot">·</span>
      <span class="tweet-time">${timeAgo(createdAt)}</span>
    </div>
  `;
}

// -------------------------------------------------------------
// Format Hashtags
// -------------------------------------------------------------
function formatContentWithHashtags(text = '') {
  const escaped = escapeHtml(text);
  return escaped.replace(/#(\w+)/g, (match, tag) => {
    return `<a href="feed.html" class="tweet-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`;
  });
}

// Global tweet cache map for resolving quotes & retweets
const tweetMap = new Map();
let myRetweetedIds = new Set();

async function resolveQuotedTweets(items) {
  items.forEach(it => {
    if (it && it._id) tweetMap.set(it._id, it);
    if (it && it.retweetOf && typeof it.retweetOf === 'object' && it.retweetOf._id) {
      tweetMap.set(it.retweetOf._id, it.retweetOf);
    }
  });

  const missingIds = items
    .filter(it => it && it.retweetOf && typeof it.retweetOf === 'string' && !tweetMap.has(it.retweetOf))
    .map(it => it.retweetOf);

  if (missingIds.length > 0) {
    const uniqueIds = [...new Set(missingIds)];
    await Promise.all(
      uniqueIds.map(id =>
        api(`/tweets/${id}`, { auth: false })
          .then(t => { if (t && t._id) tweetMap.set(t._id, t); })
          .catch(() => null)
      )
    );
  }
}

// -------------------------------------------------------------
// Tweet Card Template for Profile Stream
// -------------------------------------------------------------
function tweetCardTemplate(item, fallbackUsername) {
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
        : tweetMap.get(item.retweetOf);
      tweet = item;
    } else {
      isRepost = true;
      reposterName = item.author?.username || fallbackUsername || 'Someone';
      tweet = typeof item.retweetOf === 'object' && item.retweetOf !== null
        ? item.retweetOf
        : tweetMap.get(item.retweetOf) || item;
    }
  }

  const author = tweet.author || {};
  const authorName = author.username || (isRepost ? 'user' : fallbackUsername) || 'user';
  const authorProfileUrl = `profile.html?user=${encodeURIComponent(authorName)}&id=${author._id || ''}`;

  const likesCount = tweet.likesCount ?? (tweet.likes || []).length;
  const retweetsCount = tweet.retweetsCount ?? 0;
  const repliesCount = tweet.repliesCount ?? 0;
  const isLiked = (tweet.likes || []).some(id => id === me?._id || id?._id === me?._id);
  const retweetedByMe = myRetweetedIds.has(tweet._id);

  const isMyRepost = (reposterName && me?.username && reposterName.toLowerCase() === me.username.toLowerCase()) || (isSelf && isRepost);
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
            ${renderAuthorHeader(author, tweet.createdAt, authorName)}
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
            <button class="action-btn action-reply" data-action="reply" title="Reply" type="button">
              <span class="action-icon-circle">${ICONS.reply}</span>
              <span>${repliesCount > 0 ? repliesCount : ''}</span>
            </button>
            <button class="action-btn action-retweet ${retweetedByMe ? 'active' : ''}" data-action="retweet" title="Repost" type="button">
              <span class="action-icon-circle">${ICONS.retweet}</span>
              <span>${retweetsCount > 0 ? retweetsCount : ''}</span>
            </button>
            <button class="action-btn action-like ${isLiked ? 'active' : ''}" data-action="like" title="Like" type="button">
              <span class="action-icon-circle">${isLiked ? ICONS.heartFilled : ICONS.heart}</span>
              <span>${likesCount > 0 ? likesCount : ''}</span>
            </button>
            <button class="action-btn action-bookmark" data-action="bookmark" title="Bookmark" type="button">
              <span class="action-icon-circle">${ICONS.bookmark}</span>
            </button>
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
// Load Profile Data (Self or Other User)
// -------------------------------------------------------------
async function loadProfile() {
  const head = document.getElementById('profileHead');
  const tweetsBox = document.getElementById('profileTweets');
  const headerName = document.getElementById('profileHeaderName');
  const headerCount = document.getElementById('profileHeaderCount');

  // Pre-load global tweets to populate tweetMap for quoted tweets
  try {
    const globalTweets = await api('/tweets');
    if (Array.isArray(globalTweets)) {
      globalTweets.forEach(t => { 
        if (t && t._id && !t.isDeleted && !locallyDeletedTweetIds.has(t._id)) {
          tweetMap.set(t._id, t);
        }
      });
    }
  } catch (_) {}

  if (isSelf) {
    // ---------------- Load OWN Profile ----------------
    try {
      const user = await api('/users/profile');
      setUser(user);

      const username = user.username || me?.username || 'user';
      const displayName = user.name || `@${username}`;
      headerName.textContent = displayName;
      document.title = `${displayName} (@${username}) / 𝕏`;

      // Filter out deleted tweets and locally deleted tweets
      const posts = (user.tweets || []).filter(t => {
        if (!t || t.isDeleted || locallyDeletedTweetIds.has(t._id)) return false;
        if (!t.content && 'retweetOf' in t && t.retweetOf === null) return false;
        if (t.retweetOf) {
          if (typeof t.retweetOf === 'object' && (t.retweetOf.isDeleted || locallyDeletedTweetIds.has(t.retweetOf._id))) {
            return false;
          }
          if (typeof t.retweetOf === 'string' && locallyDeletedTweetIds.has(t.retweetOf)) {
            return false;
          }
        }
        return true;
      });
      currentProfilePosts = posts;
      headerCount.textContent = `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`;

      // Track my retweets
      myRetweetedIds = new Set();
      (user.tweets || []).forEach(t => {
        if (t && t.retweetOf) {
          const targetId = typeof t.retweetOf === 'object' && t.retweetOf !== null ? t.retweetOf._id : t.retweetOf;
          if (targetId) myRetweetedIds.add(targetId);
        }
      });

      // Register own tweets in map
      posts.forEach(t => {
        if (t && t._id) tweetMap.set(t._id, t);
        if (t && t.retweetOf && typeof t.retweetOf === 'object' && t.retweetOf._id) {
          tweetMap.set(t.retweetOf._id, t.retweetOf);
        }
      });

      // Resolve any missing quoted tweet documents
      await resolveQuotedTweets(posts);

      const joinedDate = user.createdAt
        ? new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : 'September 2026';

      head.innerHTML = `
        <div class="profile-banner"></div>
        <div class="profile-info-section">
          <div class="profile-avatar-action-row">
            <div class="profile-avatar-large">
              ${(username[0] || '?').toUpperCase()}
            </div>
            <button class="btn-profile-edit" id="openEditProfileBtn">Edit profile</button>
          </div>

          <div class="profile-full-name">${escapeHtml(displayName)}</div>
          <div class="profile-handle-text">@${escapeHtml(username)}</div>

          ${user.bio ? `<div class="profile-bio-text">${escapeHtml(user.bio)}</div>` : ''}

          <div class="profile-join-meta">
            ${ICONS.calendar}
            <span>Joined ${escapeHtml(joinedDate)}</span>
          </div>

          <!-- Only display the count numbers (no follower list disclosure) -->
          <div class="profile-stats-row">
            <div class="stat-item"><span class="stat-num">${user.followingCount ?? (Array.isArray(user.following) ? user.following.length : 0)}</span> Following</div>
            <div class="stat-item"><span class="stat-num">${user.followersCount ?? (Array.isArray(user.followers) ? user.followers.length : 0)}</span> Followers</div>
          </div>
        </div>
      `;

      setupEditProfileModal(user);

      if (!posts.length) {
        tweetsBox.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">You haven’t posted yet</div>
            <div>When you post photos, videos, or thoughts, they’ll show up here.</div>
          </div>`;
        return;
      }

      tweetsBox.innerHTML = posts.map(t => tweetCardTemplate(t, username)).join('');
    } catch (err) {
      head.innerHTML = `<div class="empty-state"><div class="empty-state-title">Profile error</div><div>${escapeHtml(err.message)}</div></div>`;
      tweetsBox.innerHTML = '';
    }
  } else {
    // ---------------- Load OTHER User's Profile ----------------
    headerName.textContent = targetUsername;
    document.title = `${targetUsername} (@${targetUsername}) / 𝕏`;

    let userBio = '';
    let userName = '';
    let isFollowing = false;
    let effectiveTargetId = targetId;
    let followersCount = 0;
    let followingCount = 0;

    // 1. Try fetching target user directly if ID is available
    if (effectiveTargetId) {
      try {
        const u = await api(`/users/${effectiveTargetId}`);
        if (u) {
          userBio = u.bio || userBio;
          userName = u.name || '';
          followersCount = u.followersCount ?? (Array.isArray(u.followers) ? u.followers.length : 0);
          followingCount = u.followingCount ?? (Array.isArray(u.following) ? u.following.length : 0);
          isFollowing = (u.followers || []).some(f => f === me?._id || f?._id === me?._id);
        }
      } catch (_) {}
    }

    // 2. Supplementary search to retrieve follower / following counts & bio
    try {
      const searchRes = await api(`/search?q=${encodeURIComponent(targetUsername)}`, { auth: false });
      const matched = (searchRes.users || []).find(u => u.username && u.username.toLowerCase() === targetUsername.toLowerCase());
      if (matched) {
        userBio = userBio || matched.bio || '';
        userName = userName || matched.name || '';
        if (!effectiveTargetId) effectiveTargetId = matched._id;
        
        if (matched.followersCount !== undefined) followersCount = matched.followersCount;
        else if (Array.isArray(matched.followers)) followersCount = matched.followers.length;

        if (matched.followingCount !== undefined) followingCount = matched.followingCount;
        else if (Array.isArray(matched.following)) followingCount = matched.following.length;

        if (!isFollowing && Array.isArray(matched.followers)) {
          isFollowing = matched.followers.some(f => f === me?._id || f?._id === me?._id);
        }
      }
    } catch (_) {}

    // 3. Check persistent follow store & user's following list
    if (isUserFollowed(effectiveTargetId, targetUsername)) {
      isFollowing = true;
    }
    if (me && Array.isArray(me.following) && effectiveTargetId) {
      if (me.following.some(f => f === effectiveTargetId || f?._id === effectiveTargetId)) {
        isFollowing = true;
      }
    }

    // Fix: If currently following this user, their follower count must be at least 1!
    if (isFollowing && followersCount === 0) {
      followersCount = 1;
    }

    const otherDisplayName = userName || `@${targetUsername}`;

    head.innerHTML = `
      <div class="profile-banner"></div>
      <div class="profile-info-section">
        <div class="profile-avatar-action-row">
          <div class="profile-avatar-large" style="background:#2f3336;">
            ${(targetUsername[0] || '?').toUpperCase()}
          </div>
          <button class="btn-follow ${isFollowing ? 'following' : ''}" id="profileFollowBtn" ${effectiveTargetId ? `data-user-id="${effectiveTargetId}"` : ''}>
            ${isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>

        <div class="profile-full-name">${escapeHtml(otherDisplayName)}</div>
        <div class="profile-handle-text">@${escapeHtml(targetUsername)}</div>

        ${userBio ? `<div class="profile-bio-text">${escapeHtml(userBio)}</div>` : ''}

        <div class="profile-join-meta">
          ${ICONS.calendar}
          <span>Joined 𝕏</span>
        </div>

        <!-- Only display the counts (plain non-clickable numbers, no list disclosure) -->
        <div class="profile-stats-row">
          <div class="stat-item"><span class="stat-num" id="statFollowingCount">${followingCount}</span> Following</div>
          <div class="stat-item"><span class="stat-num" id="statFollowersCount">${followersCount}</span> Followers</div>
        </div>
      </div>
    `;

    // Follow button interaction
    const followBtn = document.getElementById('profileFollowBtn');
    if (followBtn) {
      followBtn.addEventListener('click', async () => {
        try {
          if (!effectiveTargetId) {
            const allTweets = Array.from(tweetMap.values());
            const t = allTweets.find(t => t.author?.username?.toLowerCase() === targetUsername.toLowerCase());
            if (t?.author?._id) effectiveTargetId = t.author._id;
          }

          if (!effectiveTargetId) {
            toast('User ID unavailable');
            return;
          }

          const res = await api(`/users/${effectiveTargetId}/follow`, { method: 'POST' });
          isFollowing = !!res.following;
          followBtn.textContent = isFollowing ? 'Following' : 'Follow';
          followBtn.classList.toggle('following', isFollowing);
          setUserFollowed(effectiveTargetId, targetUsername, isFollowing);

          // Update follower count in real time
          const followersEl = document.getElementById('statFollowersCount');
          if (followersEl) {
            followersCount = isFollowing ? Math.max(1, followersCount + 1) : Math.max(0, followersCount - 1);
            followersEl.textContent = followersCount;
          }

          toast(isFollowing ? `Following @${targetUsername}` : `Unfollowed @${targetUsername}`);
        } catch (err) {
          toast(err.message);
        }
      });
    }

    // Load tweets by this user
    try {
      const allTweets = Array.from(tweetMap.values());
      const userTweets = allTweets.filter(t => 
        t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id) && (
          (t.author?.username && t.author.username.toLowerCase() === targetUsername.toLowerCase()) ||
          (effectiveTargetId && (t.author?._id === effectiveTargetId || t.author === effectiveTargetId))
        )
      );

      currentProfilePosts = userTweets;
      headerCount.textContent = `${userTweets.length} ${userTweets.length === 1 ? 'post' : 'posts'}`;

      // Resolve quoted tweets for this user's stream
      await resolveQuotedTweets(userTweets);

      if (!userTweets.length) {
        tweetsBox.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">@${escapeHtml(targetUsername)} hasn’t posted yet</div>
            <div>When they do, their posts will appear here.</div>
          </div>`;
        return;
      }

      tweetsBox.innerHTML = userTweets.map(t => tweetCardTemplate(t, targetUsername)).join('');
    } catch (err) {
      tweetsBox.innerHTML = `<div class="empty-state"><div class="empty-state-title">Posts unavailable</div><div>${escapeHtml(err.message)}</div></div>`;
    }
  }

  // Populate real users in "You might like"
  renderWhoToFollow();
}

// -------------------------------------------------------------
// Edit Profile Modal (`PUT /api/users/profile`)
// -------------------------------------------------------------
function setupEditProfileModal(currentUser) {
  const editModal = document.getElementById('editProfileModal');
  const openBtn = document.getElementById('openEditProfileBtn');
  const closeBtn = document.getElementById('closeEditProfileModalBtn');
  const saveBtn = document.getElementById('saveProfileBtn');
  const nameInput = document.getElementById('editDisplayName');
  const bioInput = document.getElementById('editBio');
  const avatarInput = document.getElementById('editAvatar');

  if (!openBtn || !editModal) return;

  openBtn.addEventListener('click', () => {
    if (nameInput) nameInput.value = currentUser.name || '';
    bioInput.value = currentUser.bio || '';
    avatarInput.value = currentUser.avatar || '';
    editModal.classList.add('open');
    if (nameInput) nameInput.focus();
    else bioInput.focus();
  });

  function closeModal() {
    editModal.classList.remove('open');
  }

  closeBtn.addEventListener('click', closeModal);
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeModal();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput ? nameInput.value.trim() : '';
    const bio = bioInput.value.trim();
    const avatar = avatarInput.value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const updated = await api('/users/profile', {
        method: 'PUT',
        body: { name, bio, avatar },
      });
      setUser(updated.user || updated);
      closeModal();
      toast('Profile updated');
      loadProfile();
    } catch (err) {
      toast(err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// -------------------------------------------------------------
// 𝕏 Single Tweet Conversation & Detail Thread Modal on Profile
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
  const likesCount = tweet.likesCount ?? (tweet.likes || []).length;
  const retweetsCount = tweet.retweetsCount ?? 0;
  const repliesCount = tweet.repliesCount ?? 0;

  // Resolve quoted tweet if any
  let quotedTweet = null;
  if (tweet.retweetOf) {
    quotedTweet = typeof tweet.retweetOf === 'object' && tweet.retweetOf !== null
      ? tweet.retweetOf
      : tweetMap.get(tweet.retweetOf);
  }

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
      <button class="action-btn action-retweet" id="detailActionRetweet" title="Repost" type="button">
        <span class="action-icon-circle">${ICONS.retweet}</span>
      </button>
      <button class="action-btn action-like ${liked ? 'active' : ''}" id="detailActionLike" title="Like" type="button">
        <span class="action-icon-circle">${liked ? ICONS.heartFilled : ICONS.heart}</span>
      </button>
      <button class="action-btn action-bookmark" id="detailActionBookmark" title="Bookmark" type="button">
        <span class="action-icon-circle">${ICONS.bookmark}</span>
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
      loadProfile();
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
      loadProfile();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('detailActionBookmark').addEventListener('click', async () => {
    try {
      await api(`/bookmarks/${tweet._id}/bookmark`, { method: 'POST' });
      toast('Bookmark updated');
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
  const allTweets = Array.from(tweetMap.values());
  const replies = allTweets.filter(t => 
    t && !t.isDeleted && !locallyDeletedTweetIds.has(t._id) &&
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
      tweetMap.set(newReply._id, newReply);
      renderDetailReplies(activeDetailTweet._id);
      
      const countEl = document.getElementById('detailRepliesMetric');
      if (countEl) {
        countEl.textContent = (parseInt(countEl.textContent || '0', 10) + 1);
      }
    }
    loadProfile();
  } catch (err) {
    toast(err.message);
  } finally {
    detailReplyBtn.disabled = false;
  }
});

// -------------------------------------------------------------
// 𝕏 Delete Post Confirmation Modal on Profile
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

    // Close detail modal if currently opened
    if (activeDetailTweet && activeDetailTweet._id === pendingDeleteTweetId) {
      closeDetailModal();
    }

    // Remove from cache and DOM
    tweetMap.delete(pendingDeleteTweetId);
    currentProfilePosts = currentProfilePosts.filter(t => t._id !== pendingDeleteTweetId && t.retweetOf !== pendingDeleteTweetId);
    document.querySelectorAll(`[data-id="${pendingDeleteTweetId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`[data-item-id="${pendingDeleteTweetId}"]`).forEach(el => el.remove());

    loadProfile();
  } catch (err) {
    toast(err.message);
  } finally {
    btnConfirmDeletePost.disabled = false;
    btnConfirmDeletePost.textContent = 'Delete';
    pendingDeleteTweetId = null;
  }
});

// -------------------------------------------------------------
// Profile Stream Actions Delegation
// -------------------------------------------------------------
document.getElementById('profileTweets').addEventListener('click', async (e) => {
  // Option Item Click (`···` more menu)
  const optionItem = e.target.closest('.tweet-option-item');
  if (optionItem) {
    e.stopPropagation();
    const option = optionItem.dataset.option;
    const tweetId = optionItem.dataset.id;
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());

    if (option === 'delete') {
      pendingDeleteTweetId = tweetId;
      deletePostModal.classList.add('open');
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
    const item = currentProfilePosts.find(t => t._id === itemId) || tweetMap.get(itemId);
    const tweet = currentProfilePosts.find(t => t._id === tweetId) || tweetMap.get(tweetId) || { _id: tweetId };
    
    // Check if author is me (either original author or reposter)
    const isMyPost = (tweet.author?._id === me?._id || tweet.author === me?._id || tweet.author?.username === me?.username || isSelf);
    const isMyItem = item && (item.author?._id === me?._id || item.author === me?._id || item.author?.username === me?.username || isSelf);
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

  // Standard Action Buttons (Like, Retweet, Bookmark, Share)
  const btn = e.target.closest('.action-btn');
  if (btn) {
    e.stopPropagation();
    const article = e.target.closest('.tweet-card');
    if (!article) return;
    const id = article.dataset.id;
    const action = btn.dataset.action;

    try {
      if (action === 'like') {
        await api(`/tweets/${id}/like`, { method: 'POST' });
        await loadProfile();
      } else if (action === 'retweet') {
        const res = await api(`/tweets/${id}/retweet`, { method: 'POST' });
        toast(res && res.msg === 'Retweet removed.' ? 'Undo repost' : 'Reposted');
        await loadProfile();
      } else if (action === 'bookmark') {
        await api(`/bookmarks/${id}/bookmark`, { method: 'POST' });
        toast('Bookmark updated');
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

  // Clicking on tweet card opens Thread / Detail Modal
  const card = e.target.closest('.tweet-card');
  if (card) {
    const id = card.dataset.id;
    let tweet = currentProfilePosts.find(t => t._id === id) || tweetMap.get(id);
    if (!tweet && id) {
      try {
        tweet = await api(`/tweets/${id}`);
        if (tweet) tweetMap.set(tweet._id, tweet);
      } catch (_) {}
    }
    if (tweet) {
      openTweetDetailModal(tweet);
    }
  }
});

// Escape key listener for modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (tweetDetailModal.classList.contains('open')) closeDetailModal();
    if (composeModal && composeModal.classList.contains('open')) closeComposeModal();
    if (deletePostModal.classList.contains('open')) {
      deletePostModal.classList.remove('open');
      pendingDeleteTweetId = null;
    }
    const editModal = document.getElementById('editProfileModal');
    if (editModal && editModal.classList.contains('open')) editModal.classList.remove('open');
    document.querySelectorAll('.emoji-popover').forEach(p => p.remove());
    document.querySelectorAll('.tweet-options-popover').forEach(p => p.remove());
  }
});

// -------------------------------------------------------------
// Real Suggested Accounts ("You might like")
// -------------------------------------------------------------
async function renderWhoToFollow() {
  const container = document.getElementById('whoToFollowList');
  if (!container) return;

  const seenUsernames = new Set();
  if (me?.username) seenUsernames.add(me.username.toLowerCase());
  if (targetUsername) seenUsernames.add(targetUsername.toLowerCase());

  const realUsers = [];

  // 1. Gather authors from cached tweets
  tweetMap.forEach(t => {
    const a = t.author;
    if (a && typeof a === 'object' && a.username && !seenUsernames.has(a.username.toLowerCase())) {
      seenUsernames.add(a.username.toLowerCase());
      realUsers.push(a);
    }
  });

  // 2. Fetch active users via general search query
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
const whoToFollowEl = document.getElementById('whoToFollowList');
if (whoToFollowEl) {
  whoToFollowEl.addEventListener('click', async (e) => {
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
}

loadProfile();
