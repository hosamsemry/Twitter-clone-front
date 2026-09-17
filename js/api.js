// ---------------------------------------------------------------
// api.js — thin wrapper around the Twitter-Clone backend API
// Change API_BASE if your server runs on a different host/port.
// (server.js defaults to PORT=7000 when no .env PORT is set)
// ---------------------------------------------------------------
const API_BASE = window.localStorage.getItem('api_base') || 'http://localhost:7000/api';

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function getUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = 'index.html';
  }
}

// Persistent tracking of followed user IDs across the session
function isUserFollowed(userId, username) {
  if (!userId && !username) return false;
  const local = JSON.parse(localStorage.getItem('followed_users') || '{}');
  if (userId && local[userId] !== undefined) return local[userId];
  if (username && local[username.toLowerCase()] !== undefined) return local[username.toLowerCase()];

  const me = getUser();
  if (me && Array.isArray(me.following)) {
    return me.following.some(f => (userId && (f === userId || f?._id === userId)) || (username && f?.username?.toLowerCase() === username.toLowerCase()));
  }
  return false;
}

function setUserFollowed(userId, username, isFollowing) {
  const local = JSON.parse(localStorage.getItem('followed_users') || '{}');
  if (userId) local[userId] = !!isFollowing;
  if (username) local[username.toLowerCase()] = !!isFollowing;
  localStorage.setItem('followed_users', JSON.stringify(local));

  // Also sync me.following array in cached user
  const me = getUser();
  if (me) {
    if (!Array.isArray(me.following)) me.following = [];
    if (isFollowing) {
      if (userId && !me.following.includes(userId)) me.following.push(userId);
    } else {
      me.following = me.following.filter(f => f !== userId && f?._id !== userId);
    }
    setUser(me);
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers['Authorization'] = `Bearer ${getToken()}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }

  if (!res.ok) {
    const msg = (data && (data.msg || data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Decode JWT payload ({ id: user._id }) to get the id
function parseJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (_) {
    return null;
  }
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="toast-text">${escapeHtml(msg)}</span>`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// Accurate Twitter/X relative & absolute timestamp formatter
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffSec = (now.getTime() - date.getTime()) / 1000;

  if (diffSec < 0) return 'now';
  if (diffSec < 60) return `${Math.max(1, Math.floor(diffSec))}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;

  const isSameYear = now.getFullYear() === date.getFullYear();
  if (isSameYear) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

// Detailed timestamp for single tweet conversation view (e.g. 1:45 AM · Sep 18, 2026)
function formatFullTimestamp(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${timePart} · ${datePart}`;
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function extractHashtags(text = '') {
  return (text.match(/#[\w]+/g) || []).map(t => t.slice(1));
}

function getAvatar(name = '?', size = 'md') {
  const letter = (name ? name[0] : '?').toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hues = [200, 215, 230, 260, 280, 320, 150];
  const hue = hues[Math.abs(hash) % hues.length];
  return `<div class="avatar avatar-${size}" style="background: hsl(${hue}, 45%, 26%)">${letter}</div>`;
}

// Pixel-perfect official 𝕏 and navigation SVG icons
const ICONS = {
  xLogo: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-x"><g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"></path></g></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M12 1.696L.622 8.807l1.06 1.696L3 9.679V19.5C3 20.881 4.119 22 5.5 22h13c1.381 0 2.5-1.119 2.5-2.5V9.679l1.318.824 1.06-1.696L12 1.696zM12 16.5c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" fill="currentColor"></path></g></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" fill="currentColor"></path></g></svg>`,
  bell: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M21.697 16.468c-.02-.016-.06-.037-.121-.08l-1.576-.985V10.5a8 8 0 0 0-7-7.938V1.5a1 1 0 0 0-2 0v1.062a8 8 0 0 0-7 7.938v4.903l-1.576.985c-.06.043-.1.064-.12.08A1.996 1.996 0 0 0 1.5 18.25h5.586a5.002 5.002 0 0 0 9.828 0H22.5c.82 0 1.54-.5 1.83-1.25.29-.75.09-1.6-.633-2.532zM12 21.25a3.003 3.003 0 0 1-2.83-2h5.66a3.003 3.003 0 0 1-2.83 2zm8.5-5H3.5v-.546l1.79-1.12c.44-.274.71-.75.71-1.266V10.5a6 6 0 1 1 12 0v2.818c0 .515.27.992.71 1.266l1.79 1.12v.546z" fill="currentColor"></path></g></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" fill="currentColor"></path></g></svg>`,
  bookmarkFilled: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z" fill="currentColor"></path></g></svg>`,
  profile: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M12 11.815c1.93 0 3.5-1.57 3.5-3.5s-1.57-3.5-3.5-3.5-3.5 1.57-3.5 3.5 1.57 3.5 3.5 3.5zm0-9c3.032 0 5.5 2.467 5.5 5.5s-2.468 5.5-5.5 5.5-5.5-2.467-5.5-5.5 2.468-5.5 5.5-5.5zm8 19.185H4a1 1 0 0 1-1-1v-.5c0-4.418 3.582-8 8-8s8 3.582 8 8v.5a1 1 0 0 1-1 1zm-14.93-2h13.86c-.53-2.82-3-5-6.93-5s-6.4 2.18-6.93 5z" fill="currentColor"></path></g></svg>`,
  reply: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor"></path></g></svg>`,
  retweet: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor"></path></g></svg>`,
  quote: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M14.23 2.854c.98-.977 2.56-.977 3.54 0l3.38 3.378c.97.977.97 2.559 0 3.536L9.91 21H3v-6.914L14.23 2.854zm2.12 1.414c-.19-.195-.51-.195-.7 0L4.41 15.51V19.59h4.08L19.73 8.35c.2-.195.2-.512 0-.707l-3.38-3.375z" fill="currentColor"></path></g></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-2.426.11-4.302 2.11-4.302 4.67 0 2.4 1.474 4.8 3.99 7.15 2.08 1.94 4.54 3.42 4.87 3.61l.14.08.14-.08c.33-.19 2.79-1.67 4.87-3.61 2.516-2.35 3.99-4.75 3.99-7.15 0-2.56-1.876-4.56-4.304-4.67zM12 20.47c-.82-.55-6.52-4.48-6.52-10.3 0-1.47 1.066-2.67 2.45-2.74 1.135-.06 2.42.59 3.09 1.79l.98 1.74.98-1.74c.67-1.2 1.955-1.85 3.09-1.79 1.384.07 2.45 1.27 2.45 2.74 0 5.82-5.7 9.75-6.52 10.3z" fill="currentColor"></path></g></svg>`,
  heartFilled: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-liked"><g><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3C7.12 18.31 4.47 15.67 3.118 13.19 1.986 11.12 1.9 8.7 2.87 6.47c.97-2.22 2.873-3.72 5.215-3.72 2.378 0 4.148 1.41 5.115 2.86.966-1.45 2.737-2.86 5.115-2.86 2.342 0 4.246 1.5 5.216 3.72.969 2.23.883 4.65-.247 6.72z" fill="#f91880"></path></g></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41L7.71 9.71 6.3 8.29 12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21.01 3 19.9 3 18.51V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor"></path></g></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" fill="currentColor"></path></g></svg>`,
  backArrow: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" fill="currentColor"></path></g></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" fill="currentColor"></path></g></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M16 6V4.5C16 3.12 14.88 2 13.5 2h-3C9.11 2 8 3.12 8 4.5V6H3v2h1.06l.81 12.19C4.94 21.31 5.86 22 7 22h10c1.14 0 2.06-.69 2.13-1.81L19.94 8H21V6h-5zm-6-1.5c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5V6h-4V4.5zm7.13 15.37c-.02.35-.33.63-.63.63H7.5c-.3 0-.61-.28-.63-.63L6.07 8h11.86l-.8 11.87zM10 10h2v8h-2v-8zm4 0h2v8h-2v-8z" fill="currentColor"></path></g></svg>`,
  media: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-3.086zM9.75 8.75c0 .69-.56 1.25-1.25 1.25s-1.25-.56-1.25-1.25.56-1.25 1.25-1.25 1.25.56 1.25 1.25z" fill="currentColor"></path></g></svg>`,
  gif: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM10 8H7v8h3v-2H8.5v-1H10V8zm4 0h-2v8h2V8zm4 0h-3.5v8h1.5v-3h1.5v-1.5H16V9.5h2V8z" fill="currentColor"></path></g></svg>`,
  emoji: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M8 9.5C8 8.67 8.67 8 9.5 8s1.5.67 1.5 1.5-.67 1.5-1.5 1.5S8 10.33 8 9.5zm6 0c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM12 18c2.28 0 4.22-1.66 5-4H7c.78 2.34 2.72 4 5 4zm-9-6C3 7.03 7.03 3 12 3s9 4.03 9 9-4.03 9-9 9-9-4.03-9-9zm2 0c0 3.86 3.14 7 7 7s7-3.14 7-7-3.14-7-7-7-7 3.14-7 7z" fill="currentColor"></path></g></svg>`,
  calendar: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v1.5h14V6.5c0-.28-.23-.5-.5-.5H17v1h-2V6H9v1H7V6zm12 4H5v8.5c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5V10z" fill="currentColor"></path></g></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><g><path d="M9 20l-5.5-5.5 1.4-1.4 4.1 4.1 11.6-11.6 1.4 1.4z" fill="currentColor"></path></g></svg>`
};
