const PROCESS_SUBVIEWS = new Set(['canvas', 'activity', 'estimate', 'settings', 'responsibility']);

export function readRoute(pathname = window.location.pathname) {
  const teamMatch = pathname.match(/^\/team(?:\/(tools|financial-goals|online|admin))?\/?$/);
  if (teamMatch) {
    const teamTab = teamMatch[1] === 'tools' ? 'tools' : teamMatch[1] === 'financial-goals' ? 'goals' : teamMatch[1] === 'online' ? 'online' : teamMatch[1] === 'admin' ? 'admin' : 'team';
    return { page: 'team', processId: null, subview: 'canvas', activityOpen: false, teamTab };
  }
  const match = pathname.match(/^\/processes\/([^/]+)(?:\/(activity|estimate|settings|responsibility))?\/?$/);
  if (match) {
    const subview = PROCESS_SUBVIEWS.has(match[2] || 'canvas') ? (match[2] || 'canvas') : 'canvas';
    return { page: 'canvas', processId: decodeURIComponent(match[1]), subview, activityOpen: subview === 'activity', teamTab: 'team' };
  }
  return { page: 'canvas', processId: null, subview: 'canvas', activityOpen: false, teamTab: 'team' };
}

export function processPath(processId, subview = 'canvas') {
  const path = `/processes/${encodeURIComponent(processId)}`;
  return subview && subview !== 'canvas' && PROCESS_SUBVIEWS.has(subview) ? `${path}/${subview}` : path;
}

export function teamPath(tab = 'team') {
  if (tab === 'tools') return '/team/tools';
  if (tab === 'goals' || tab === 'financial-goals') return '/team/financial-goals';
  if (tab === 'online') return '/team/online';
  if (tab === 'admin') return '/team/admin';
  return '/team';
}
