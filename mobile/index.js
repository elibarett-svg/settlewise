// App entry. The web demo can be served from any path (for example /index.html),
// so it starts the router at "/" instead of reading the page's URL.
if (process.env.EXPO_PUBLIC_DEMO === '1' && typeof window !== 'undefined' && window.location.pathname !== '/') {
  window.history.replaceState(null, '', '/');
}

require('expo-router/entry');
